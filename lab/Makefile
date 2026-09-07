# Local GitLab lab. URLs and credentials live in compose.yaml and seed.ts.
# Run from this directory, or from the repo root with `make -C lab <target>`.
# The first full start pulls about 3.2 GB and may take 10 minutes. Both seeded
# instances measured about 6.5 GiB idle; check host capacity before `make up`.

COMPOSE := docker compose -f compose.yaml
INSTANCES := gitlab-18 gitlab-19
LAB_DIR := $(abspath $(dir $(lastword $(MAKEFILE_LIST))))
REPO_ROOT := $(abspath $(LAB_DIR)/..)
LAB_EXTENSION_PROJECT := $(REPO_ROOT)/.ignore/lab-extension
EXTENSION := $(REPO_ROOT)/node_modules/.bin/extension
LAB_START_URL := http://localhost:10019/tonic-lab/frontend/-/merge_requests

.DEFAULT_GOAL := help
.PHONY: help up down restart cleanup seed status logs token extension-project verify-extension

help: ## List targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | sed -E 's/:.*## /|/' | awk -F'|' '{printf "  make %-18s %s\n", $$1, $$2}'

up: ## Start both instances and seed them. Safe to re-run
	$(COMPOSE) up -d $(INSTANCES)
	$(COMPOSE) run --rm seed

down: ## Stop and remove containers, keep all data
	$(COMPOSE) down

restart: ## Restart both instances, keep all data
	$(COMPOSE) restart $(INSTANCES)

cleanup: ## Remove containers AND volumes. Deletes every seeded object
	$(COMPOSE) down -v --remove-orphans

seed: ## Re-run the seeder only. Reuses what exists, creates what is missing
	$(COMPOSE) run --rm seed

status: ## Show container state and health
	$(COMPOSE) ps

logs: ## Print the last 200 log lines per instance, without following
	$(COMPOSE) logs --tail=200 $(INSTANCES)

token: ## Print the admin API token of each instance
	@for i in $(INSTANCES); do printf '%s ' "$$i"; $(COMPOSE) exec -T $$i cat /lab/token-$${i#gitlab-}; echo; done

# Lab origins arrive as required host permissions, which Chrome grants without a
# prompt. Add one through Tonic's toolbar to register its content script.
extension-project: ## Generate the ignored extension project with granted lab origins
	bun "$(LAB_DIR)/extension/prepare-test-extension.ts"

# Use a fresh Extension.js session for each GitLab version. Cross-origin navigation
# can leave the development bridge in the back-forward cache and pollute later logs.
verify-extension: extension-project ## Launch Chrome with the lab extension project
	EXTENSION_NO_RELOAD=1 "$(EXTENSION)" dev "$(LAB_EXTENSION_PROJECT)" --browser chrome --starting-url "$(LAB_START_URL)" --allow-control --logs info
