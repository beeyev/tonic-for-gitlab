import { createRoot, type Root } from "react-dom/client";
import type { TonicSettings } from "../../settings/repository";
import { getMutationObserver } from "../runtime/dom-globals";
import {
	InPageControlPanelView,
	type InPageFeatureCompatibility,
	type SettingChangeHandlers,
} from "./in-page-control-panel";

export const IN_PAGE_CONTROL_PANEL_ROOT_ATTRIBUTE =
	"data-tonic-for-gitlab-in-page-control-panel-root";
export const IN_PAGE_CONTROL_PANEL_STYLES_ATTRIBUTE =
	"data-tonic-for-gitlab-in-page-control-panel-styles";

interface MountedInPageControlPanel {
	destroy(): void;
	updateCompatibility(compatibility: InPageFeatureCompatibility): void;
	updateSettings(settings: TonicSettings): void;
}

function setHostTheme(host: HTMLElement, document: Document): void {
	if (document.documentElement.classList.contains("gl-dark")) {
		host.setAttribute("data-tonic-theme", "dark");
		return;
	}

	host.removeAttribute("data-tonic-theme");
}

export function mountInPageControlPanel(
	host: HTMLElement,
	document: Document,
	initialSettings: TonicSettings,
	initialCompatibility: InPageFeatureCompatibility,
	handlers: SettingChangeHandlers,
	stylesheet: string,
): MountedInPageControlPanel {
	const shadowRoot = host.attachShadow({ mode: "open" });
	const style = document.createElement("style");
	style.setAttribute(IN_PAGE_CONTROL_PANEL_STYLES_ATTRIBUTE, "");
	style.textContent = stylesheet;
	const mountingPoint = document.createElement("div");
	shadowRoot.append(style, mountingPoint);

	setHostTheme(host, document);
	const themeObserver = new (getMutationObserver(document))(() => {
		setHostTheme(host, document);
	});
	themeObserver.observe(document.documentElement, {
		attributeFilter: ["class"],
		attributes: true,
	});

	let root: Root | undefined = createRoot(mountingPoint);
	let settings = initialSettings;
	let compatibility = initialCompatibility;
	let isDestroyed = false;

	const render = () => {
		root?.render(
			<InPageControlPanelView
				compatibility={compatibility}
				portalContainer={shadowRoot}
				settings={settings}
				handlers={handlers}
			/>,
		);
	};

	render();

	return {
		destroy() {
			if (isDestroyed) {
				return;
			}

			isDestroyed = true;
			themeObserver.disconnect();
			root?.unmount();
			root = undefined;
			host.remove();
		},
		updateCompatibility(nextCompatibility) {
			if (isDestroyed) {
				return;
			}

			compatibility = nextCompatibility;
			render();
		},
		updateSettings(nextSettings) {
			if (isDestroyed) {
				return;
			}

			settings = nextSettings;
			render();
		},
	};
}
