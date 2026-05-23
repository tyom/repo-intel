.DEFAULT_GOAL := help

# Ruff is run via uvx so there's nothing to install or commit; pinned for
# reproducibility between local runs and CI.
RUFF := uvx ruff@0.14.5

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-12s\033[0m %s\n", $$1, $$2}'

web-build: ## Build the frontend bundle (web/dist/index.html) with Bun + Vite
	cd web && bun install --frozen-lockfile && bun run build

web-dev: ## Run the frontend dev server with HMR (reads web/public/mock-data.json)
	cd web && bun run dev

web-check: ## Type-check the frontend (svelte-check); does not build
	cd web && bun install --frozen-lockfile && bun run check

format: py-format ## Format the whole repo (Prettier + Ruff)
	@bun install --frozen-lockfile >/dev/null && bunx prettier --write .

format-check: ## Check formatting with Prettier (CI); does not write
	@bun install --frozen-lockfile >/dev/null && bunx prettier --check .

py-lint: ## Lint the Python sources with Ruff
	@$(RUFF) check .

py-format: ## Format the Python sources with Ruff
	@$(RUFF) format .

py-format-check: ## Check Python formatting with Ruff (CI); does not write
	@$(RUFF) format --check .

check: format-check py-lint py-format-check web-check ## Run all static checks (mirrors CI gates)

build: web-build ## Build the single-file artifact into dist/repo-intel
	python3 build.py dist/repo-intel

techdata: ## Regenerate techdata.json from GitHub Linguist (needs network)
	python3 gen_techdata.py

dev: web-build ## Run from source (reads web/dist/index.html + techdata.json live; pass args via ARGS=)
	python3 repo-intel.py $(ARGS)

install-hooks: ## Point git at the tracked .githooks/ (auto-rebuilds dist on commit)
	git config core.hooksPath .githooks
	@echo "core.hooksPath -> .githooks"

gc: ## Repack git history (committed dist/repo-intel deltas down to ~nothing)
	@before=$$(git count-objects -vH | awk '/size-pack:/{print $$2 $$3}'); \
	git gc --quiet; \
	after=$$(git count-objects -vH | awk '/size-pack:/{print $$2 $$3}'); \
	echo "pack: $$before -> $$after"

.PHONY: help web-build web-dev web-check format format-check py-lint py-format py-format-check check build techdata dev install-hooks gc
