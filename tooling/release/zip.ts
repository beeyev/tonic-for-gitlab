import { deflateRawSync, inflateRawSync } from "node:zlib";

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_OF_CENTRAL_DIRECTORY_SIZE = 22;

// A ZIP timestamp carries no information a browser reads, and a wall-clock
// value is the only thing that stops two builds of one commit from producing
// identical bytes. Pin it to the oldest instant the DOS format can encode.
export const DOS_EPOCH_SECONDS = 315_532_800;

// MS-DOS "version made by" keeps host attributes and UNIX permission bits out
// of the archive, so the umask of the build machine cannot leak into the bytes.
const VERSION_MADE_BY = 20;
const VERSION_NEEDED = 20;

// Bit 11 is the language encoding flag. Entry names are written as UTF-8, and
// without this a conforming reader decodes them as CP437, so a name outside
// ASCII extracts under a different filename than the manifest references.
const FLAG_UTF8_NAMES = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffff_ffff;

export interface ZipEntry {
	name: string;
	data: Uint8Array;
}

export interface ZipEntryRecord {
	name: string;
	crc32: number;
	compressedSize: number;
	uncompressedSize: number;
	method: number;
}

export interface CreateZipOptions {
	modifiedAt?: number;
}

function assertSafeEntryName(name: string, seen: Set<string>): void {
	if (name.length === 0) {
		throw new TypeError("ZIP entry names must not be empty");
	}

	if (Buffer.byteLength(name, "utf8") > MAX_UINT16) {
		throw new TypeError(`ZIP entry name is too long: ${name}`);
	}

	if (name.includes("\\")) {
		throw new TypeError(`ZIP entry names must use forward slashes: ${name}`);
	}

	if (name.startsWith("/")) {
		throw new TypeError(`ZIP entry names must be relative: ${name}`);
	}

	if (name.split("/").some((segment) => segment === "." || segment === "..")) {
		throw new TypeError(`ZIP entry names must not traverse: ${name}`);
	}

	if (seen.has(name)) {
		throw new TypeError(`Duplicate ZIP entry name: ${name}`);
	}

	seen.add(name);
}

function toDosDateTime(epochSeconds: number): { date: number; time: number } {
	const at = new Date(Math.max(epochSeconds, DOS_EPOCH_SECONDS) * 1000);

	return {
		date:
			((at.getUTCFullYear() - 1980) << 9) |
			((at.getUTCMonth() + 1) << 5) |
			at.getUTCDate(),
		time:
			(at.getUTCHours() << 11) |
			(at.getUTCMinutes() << 5) |
			(at.getUTCSeconds() >> 1),
	};
}

function compress(data: Uint8Array): { method: number; body: Buffer } {
	const deflated = deflateRawSync(data, { level: 9 });

	// Already-compressed payloads such as PNG icons grow under deflate. Picking
	// the smaller of the two is still deterministic for identical input.
	return deflated.length < data.length
		? { method: METHOD_DEFLATE, body: deflated }
		: { method: METHOD_STORE, body: Buffer.from(data) };
}

/**
 * Build a ZIP archive whose bytes depend only on the entry names and contents.
 * Entries are emitted in sorted byte order with a pinned timestamp, no extra
 * fields, and no host attributes.
 */
export function createDeterministicZip(
	entries: readonly ZipEntry[],
	options: CreateZipOptions = {},
): Buffer {
	const seen = new Set<string>();
	const sorted = [...entries].sort((left, right) =>
		Buffer.compare(
			Buffer.from(left.name, "utf8"),
			Buffer.from(right.name, "utf8"),
		),
	);
	for (const entry of sorted) {
		assertSafeEntryName(entry.name, seen);
	}

	const { date, time } = toDosDateTime(options.modifiedAt ?? DOS_EPOCH_SECONDS);
	const localParts: Buffer[] = [];
	const centralParts: Buffer[] = [];
	let offset = 0;

	for (const entry of sorted) {
		const name = Buffer.from(entry.name, "utf8");
		const { method, body } = compress(entry.data);
		const crc32 = Bun.hash.crc32(entry.data);

		if (offset > MAX_UINT32 || entry.data.length > MAX_UINT32) {
			throw new RangeError("ZIP64 archives are not supported");
		}

		const local = Buffer.alloc(LOCAL_HEADER_SIZE);
		local.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
		local.writeUInt16LE(VERSION_NEEDED, 4);
		local.writeUInt16LE(FLAG_UTF8_NAMES, 6);
		local.writeUInt16LE(method, 8);
		local.writeUInt16LE(time, 10);
		local.writeUInt16LE(date, 12);
		local.writeUInt32LE(crc32, 14);
		local.writeUInt32LE(body.length, 18);
		local.writeUInt32LE(entry.data.length, 22);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(0, 28);
		localParts.push(local, name, body);

		const central = Buffer.alloc(CENTRAL_HEADER_SIZE);
		central.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
		central.writeUInt16LE(VERSION_MADE_BY, 4);
		central.writeUInt16LE(VERSION_NEEDED, 6);
		central.writeUInt16LE(FLAG_UTF8_NAMES, 8);
		central.writeUInt16LE(method, 10);
		central.writeUInt16LE(time, 12);
		central.writeUInt16LE(date, 14);
		central.writeUInt32LE(crc32, 16);
		central.writeUInt32LE(body.length, 20);
		central.writeUInt32LE(entry.data.length, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt16LE(0, 30);
		central.writeUInt16LE(0, 32);
		central.writeUInt16LE(0, 34);
		central.writeUInt16LE(0, 36);
		central.writeUInt32LE(0, 38);
		central.writeUInt32LE(offset, 42);
		centralParts.push(central, name);

		offset += local.length + name.length + body.length;
	}

	const centralDirectory = Buffer.concat(centralParts);
	const end = Buffer.alloc(END_OF_CENTRAL_DIRECTORY_SIZE);
	end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
	end.writeUInt16LE(0, 4);
	end.writeUInt16LE(0, 6);
	end.writeUInt16LE(sorted.length, 8);
	end.writeUInt16LE(sorted.length, 10);
	end.writeUInt32LE(centralDirectory.length, 12);
	end.writeUInt32LE(offset, 16);
	end.writeUInt16LE(0, 20);

	return Buffer.concat([...localParts, centralDirectory, end]);
}

function findEndOfCentralDirectory(archive: Buffer): number {
	for (
		let index = archive.length - END_OF_CENTRAL_DIRECTORY_SIZE;
		index >= 0;
		index--
	) {
		if (archive.readUInt32LE(index) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
			return index;
		}
	}

	throw new TypeError("Archive has no end of central directory record");
}

/** Read the central directory, so a written archive can be re-verified. */
export function readZipEntries(archive: Buffer): ZipEntryRecord[] {
	const end = findEndOfCentralDirectory(archive);
	const total = archive.readUInt16LE(end + 10);
	const records: ZipEntryRecord[] = [];
	let cursor = archive.readUInt32LE(end + 16);

	for (let index = 0; index < total; index++) {
		if (archive.readUInt32LE(cursor) !== CENTRAL_HEADER_SIGNATURE) {
			throw new TypeError("Corrupt central directory header");
		}

		const nameLength = archive.readUInt16LE(cursor + 28);
		const extraLength = archive.readUInt16LE(cursor + 30);
		const commentLength = archive.readUInt16LE(cursor + 32);
		records.push({
			name: archive.toString(
				"utf8",
				cursor + CENTRAL_HEADER_SIZE,
				cursor + CENTRAL_HEADER_SIZE + nameLength,
			),
			method: archive.readUInt16LE(cursor + 10),
			crc32: archive.readUInt32LE(cursor + 16),
			compressedSize: archive.readUInt32LE(cursor + 20),
			uncompressedSize: archive.readUInt32LE(cursor + 24),
		});
		cursor += CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;
	}

	return records;
}

/** Read one entry back out of an archive and verify its CRC. */
export function readZipEntry(archive: Buffer, name: string): Buffer {
	const end = findEndOfCentralDirectory(archive);
	const total = archive.readUInt16LE(end + 10);
	let cursor = archive.readUInt32LE(end + 16);

	for (let index = 0; index < total; index++) {
		const nameLength = archive.readUInt16LE(cursor + 28);
		const extraLength = archive.readUInt16LE(cursor + 30);
		const commentLength = archive.readUInt16LE(cursor + 32);
		const entryName = archive.toString(
			"utf8",
			cursor + CENTRAL_HEADER_SIZE,
			cursor + CENTRAL_HEADER_SIZE + nameLength,
		);

		if (entryName === name) {
			const localOffset = archive.readUInt32LE(cursor + 42);
			const localNameLength = archive.readUInt16LE(localOffset + 26);
			const localExtraLength = archive.readUInt16LE(localOffset + 28);
			const dataStart =
				localOffset + LOCAL_HEADER_SIZE + localNameLength + localExtraLength;
			const body = archive.subarray(
				dataStart,
				dataStart + archive.readUInt32LE(cursor + 20),
			);
			const data =
				archive.readUInt16LE(cursor + 10) === METHOD_STORE
					? Buffer.from(body)
					: inflateRawSync(body);

			if (Bun.hash.crc32(data) !== archive.readUInt32LE(cursor + 16)) {
				throw new TypeError(`Checksum mismatch for ZIP entry: ${name}`);
			}

			return data;
		}

		cursor += CENTRAL_HEADER_SIZE + nameLength + extraLength + commentLength;
	}

	throw new TypeError(`Missing ZIP entry: ${name}`);
}
