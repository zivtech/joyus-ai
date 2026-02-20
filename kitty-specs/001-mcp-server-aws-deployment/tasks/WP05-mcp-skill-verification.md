---
work_package_id: WP05
title: MCP Server & Skill Runtime Verification
lane: planned
dependencies: []
subtasks: [T021, T022, T023, T024, T025, T026, T027]
history:
- date: '2026-02-12'
  event: Created
  agent: spec-kitty.tasks
---

# WP05: MCP Server & Skill Runtime Verification

**Implement with**: `spec-kitty implement WP05 --base WP01`

## Objective

Verify that all 10 MCP server endpoints and all skill runtime dependencies work correctly inside the Docker containers. This is a validation work package — the code is already built, but must be confirmed working in the containerized environment.

## Context

- **Dependencies**: WP01 (containers must be running via `docker compose up`)
- **MCP servers to verify**: joyus-ai (Jira, Slack, GitHub, Google), Playwright, Memory, PowerPoint, Excel, Word
- **Skill audit result**: 19 total skills — 10 prompt-only (no CLI deps), 9 require CLI tools (Python, squirrel, git/composer/drush)
- **Container-only skills**: local-drupal-development and drupal-setup require Lando/DDEV (workstation-only, excluded from server)
- **Reference**: See `spec.md` FR1 and FR2, skill audit in spec session

## Subtasks

### T021: Verify joyus-ai MCP Server Tool Executors

**Purpose**: Confirm that Jira, Slack, GitHub, and Google tool executors respond correctly in the container.

**Steps**:
1. Start containers: `docker compose up -d`
2. Test each tool executor via MCP protocol or HTTP:
   - **Jira**: `jira_search` — search for a known issue (e.g., "type = Bug ORDER BY created DESC")
   - **Slack**: `slack_post_message` — post to a test channel (e.g., #bot-testing)
   - **GitHub**: `github_list_repos` — list repos for the organization
   - **Google**: `google_search` — execute a simple query
3. Verify OAuth token refresh works (tokens are encrypted in PostgreSQL)
4. Verify bearer token authentication on the `/mcp` endpoint
5. All responses should match expected MCP tool response format

**Validation**:
- [ ] Jira search returns results
- [ ] Slack message posts successfully
- [ ] GitHub lists repositories
- [ ] Google query returns results
- [ ] OAuth token refresh works (test with expired token if possible)
- [ ] Bearer token authentication enforced (401 without token)

**Edge Cases**:
- OAuth tokens migrated from local dev may need re-authorization for production environment
- Rate limits on external APIs (Jira, Slack, GitHub) — use lightweight test queries
- Network connectivity from EC2 to external APIs must be verified

---

### T022: Verify Playwright MCP + Backstop.js Visual Regression [P]

**Purpose**: Confirm Playwright browser automation and Backstop.js visual regression work in the container.

**Steps**:
1. Test Playwright navigation:
   ```
   Tool: playwright_navigate
   Input: { "url": "https://example.com" }
   Expected: Page loads successfully, returns page title
   ```
2. Test Playwright screenshot:
   ```
   Tool: playwright_screenshot
   Input: { "url": "https://example.com", "fullPage": true }
   Expected: Returns screenshot image data
   ```
3. Test Backstop.js reference capture:
   ```bash
   docker exec playwright npx backstop reference --config=backstop.json
   ```
4. Test Backstop.js comparison:
   ```bash
   docker exec playwright npx backstop test --config=backstop.json
   ```
5. Verify headless mode (no display/Xvfb required)

**Validation**:
- [ ] Playwright navigates to URL and returns content
- [ ] Screenshot captured successfully
- [ ] Backstop.js reference command completes
- [ ] Backstop.js test comparison works
- [ ] No display server required (headless mode)

**Edge Cases**:
- Chromium may need `--no-sandbox` flag inside Docker (the official Playwright image handles this)
- Memory-intensive pages may OOM in the container — test with realistic sites
- DNS resolution must work from inside the container

---

### T023: Verify Memory MCP Persistent Knowledge Graph [P]

**Purpose**: Confirm the Memory MCP server creates entities and persists them across container restarts.

**Steps**:
1. Create a test entity:
   ```
   Tool: memory_create_entity
   Input: { "name": "test-verification", "type": "test", "content": "Verification entity for deployment" }
   ```
2. Query the entity:
   ```
   Tool: memory_search
   Input: { "query": "test-verification" }
   Expected: Returns the created entity
   ```
3. Restart containers: `docker compose restart`
4. Query again — entity should still exist (persistent volume)
5. Clean up: delete the test entity

**Validation**:
- [ ] Entity created successfully
- [ ] Entity retrieved via search
- [ ] Entity persists after `docker compose restart`
- [ ] Entity persists after `docker compose down && docker compose up`
- [ ] Docker volume `memory-data` exists and is mounted correctly

**Edge Cases**:
- Memory MCP stores data as files — volume mount path must be correct
- File permissions inside container must allow read/write

---

### T024: Verify Office MCP Servers (PowerPoint, Excel, Word) [P]

**Purpose**: Confirm Office document creation works via MCP tool calls.

**Steps**:
1. Test PowerPoint:
   ```
   Tool: powerpoint_create
   Input: { "title": "Test Presentation", "slides": [{"title": "Slide 1", "content": "Test content"}] }
   Expected: Returns PPTX file data or path
   ```
2. Test Excel:
   ```
   Tool: excel_create
   Input: { "sheets": [{"name": "Sheet1", "data": [["A", "B"], [1, 2]]}] }
   Expected: Returns XLSX file data or path
   ```
3. Test Word:
   ```
   Tool: word_create
   Input: { "title": "Test Document", "content": "Test paragraph content" }
   Expected: Returns DOCX file data or path
   ```
4. Verify output files are valid (can be opened by Office or LibreOffice)

**Validation**:
- [ ] PowerPoint file created with correct slide content
- [ ] Excel file created with correct sheet data
- [ ] Word document created with correct text content
- [ ] Generated files are valid Office format (not corrupted)
- [ ] MCP tool calls return appropriate success responses

---

### T025: Test Skill Runtime — Python Packages

**Purpose**: Verify all Python packages required by skills are importable in the Platform container.

**Steps**:
1. Run import check:
   ```bash
   docker exec platform python3 -c "
   import pptx
   import docx
   import openpyxl
   import lxml
   import pypdf
   from PIL import Image
   import imageio
   import numpy
   import requests
   import yaml
   import packaging
   print('All Python packages imported successfully')
   "
   ```
2. Test a functional operation with each key package:
   ```bash
   # python-pptx: create a minimal presentation
   docker exec platform python3 -c "
   from pptx import Presentation
   p = Presentation()
   p.slides.add_slide(p.slide_layouts[0])
   p.save('/tmp/test.pptx')
   print('python-pptx: OK')
   "

   # pillow: create a minimal image
   docker exec platform python3 -c "
   from PIL import Image
   img = Image.new('RGB', (100, 100), 'red')
   img.save('/tmp/test.png')
   print('pillow: OK')
   "
   ```
3. Verify Python venv is active and correct:
   ```bash
   docker exec platform python3 -c "import sys; print(sys.prefix)"
   # Expected: /opt/venv
   ```

**Validation**:
- [ ] All 11 Python packages import without error
- [ ] python-pptx can create a valid PPTX file
- [ ] pillow can create and save an image
- [ ] Python venv path is `/opt/venv`
- [ ] pip list shows all expected packages

---

### T026: Test Skill Runtime — Squirrel CLI [P]

**Purpose**: Verify the squirrel (SquirrelScan) binary works in the Platform container.

**Steps**:
1. Check squirrel is installed:
   ```bash
   docker exec platform squirrel --version
   ```
2. Run a basic audit:
   ```bash
   docker exec platform squirrel audit https://example.com --format llm
   ```
3. Verify the output contains expected audit categories (SEO, performance, security, etc.)
4. Verify squirrel can resolve DNS and make HTTPS requests from inside the container

**Validation**:
- [ ] `squirrel --version` returns version info
- [ ] `squirrel audit` completes on a real URL
- [ ] Output format is correct (LLM-friendly text)
- [ ] DNS and HTTPS work from inside the container

**Edge Cases**:
- Squirrel install script may place binary in different locations — verify PATH
- Audit may timeout on slow sites — use known-fast URL for testing
- Some squirrel features may need additional dependencies — verify with `--format llm`

---

### T027: Test Skill Runtime — Git, Composer, Drush [P]

**Purpose**: Verify git, composer, and drush are installed and functional for Drupal contribution skills.

**Steps**:
1. Verify installations:
   ```bash
   docker exec platform git --version
   # Expected: git version 2.x

   docker exec platform composer --version
   # Expected: Composer version 2.x

   docker exec platform drush --version
   # Expected: Drush version 12.x or 13.x
   ```
2. Test git operations:
   ```bash
   docker exec platform bash -c "cd /tmp && git clone --depth 1 https://git.drupalcode.org/project/drupal.git && echo 'git clone: OK'"
   ```
3. Test composer:
   ```bash
   docker exec platform composer global show
   # Should list drush/drush
   ```
4. Verify PHP is available (required by composer and drush):
   ```bash
   docker exec platform php --version
   # Expected: PHP 8.x
   ```

**Validation**:
- [ ] `git --version` succeeds
- [ ] `composer --version` succeeds
- [ ] `drush --version` succeeds
- [ ] `php --version` succeeds
- [ ] `git clone` works (network access from container)
- [ ] Composer global bin path includes drush

**Edge Cases**:
- Composer global bin path (`~/.composer/vendor/bin`) must be in PATH
- drush requires PHP — both php-cli and required extensions must be installed
- git.drupalcode.org may have rate limits — use shallow clone for testing

## Definition of Done

- [ ] All 4 joyus-ai tool executors (Jira, Slack, GitHub, Google) respond correctly
- [ ] Playwright navigates and captures screenshots
- [ ] Backstop.js reference/test workflow completes
- [ ] Memory MCP persists data across restarts
- [ ] Office MCP servers create valid documents (PPT, Excel, Word)
- [ ] All 11 Python packages import successfully
- [ ] Squirrel CLI runs website audits
- [ ] Git, composer, drush all installed and functional
- [ ] All tests run inside Docker containers (not on host)

## Risks

- **OAuth re-authorization**: Production OAuth tokens may need fresh consent if redirect URIs change
- **External API availability**: Tests depend on Jira, Slack, GitHub, Google being reachable — use lightweight queries
- **Container resource limits**: Playwright + squirrel audits are memory-intensive — may hit limits on t3.small
- **Squirrel binary updates**: If squirrel install script changes between Dockerfile build and verification, binary may be missing or wrong version
