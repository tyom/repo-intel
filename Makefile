.DEFAULT_GOAL := help

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-12s\033[0m %s\n", $$1, $$2}'

web-build: ## Build the frontend bundle (web/dist/index.html) with Bun + Vite
	cd web && bun install --frozen-lockfile && bun run build

web-dev: ## Run the frontend dev server with HMR (reads web/public/mock-data.json)
	cd web && bun run dev

build: web-build ## Build the single-file artifact into dist/repo-intel
	python3 build.py dist/repo-intel

techdata: ## Regenerate techdata.json from GitHub Linguist (needs network)
	python3 gen_techdata.py

dev: web-build ## Run from source (reads web/dist/index.html + techdata.json live; pass args via ARGS=)
	python3 repo-intel.py $(ARGS)

install-hooks: ## Point git at the tracked .githooks/ (auto-rebuilds dist on commit)
	git config core.hooksPath .githooks
	@echo "core.hooksPath -> .githooks"

.PHONY: help web-build web-dev build techdata dev install-hooks
