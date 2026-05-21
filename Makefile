.DEFAULT_GOAL := help

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-12s\033[0m %s\n", $$1, $$2}'

build: ## Build the single-file artifact into dist/repo-intel
	python3 build.py dist/repo-intel

techdata: ## Regenerate techdata.json from GitHub Linguist (needs network)
	python3 gen_techdata.py

dev: ## Run from source (reads template.html + techdata.json live; pass args via ARGS=)
	python3 repo-intel.py $(ARGS)

.PHONY: help build techdata dev
