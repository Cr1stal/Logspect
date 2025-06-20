# Log Parser Test Suite

This directory contains comprehensive test cases for the log parser module (`logParser.js`).

## Overview

The log parser is responsible for parsing Rails application log lines and extracting structured information including:

- UUID/Job ID extraction
- Log type classification (web requests, background jobs, system logs)
- Success/failure determination
- Metadata extraction (timing, status codes, etc.)
- Title generation for display

## Test Coverage

### Core Functionality Tests

#### 1. Regex Pattern Tests

- **`uuidRegex`**: Tests UUID pattern matching in brackets `[uuid]`
- **`jidRegex`**: Tests job ID pattern matching for background jobs

#### 2. Log Information Extraction (`extractLogInfo`)

- **Background Job Logs**:
  - Job class and ID extraction
  - Success/failure detection
  - Elapsed time parsing
  - Database timing extraction
- **Web Request Logs**:
  - HTTP method and path extraction
  - Status code parsing
  - Response time extraction
  - Success determination based on status codes
- **System Logs**:
  - Title generation from log content
  - Log level detection
  - Word filtering (removes short words, numbers, exact log level matches)
  - Title truncation for long messages

#### 3. Log Line Parsing (`parseLogLine`, `parseLogLines`)

- UUID-based log line parsing
- Job ID-based log line parsing
- Time-based UUID generation for system logs
- VT control character stripping
- Empty/whitespace line handling
- Multiple log line processing

#### 4. Validation Functions

- **`isValidUuid`**: UUID format validation
- **`isValidJid`**: Job ID format validation (24-character hex strings)

#### 5. Time-based UUID Generation

- Grouping system logs within 2-second windows
- Creating new UUIDs after time gaps

### Edge Cases and Error Handling

- Malformed log lines
- Special characters and Unicode content
- Binary content handling
- Very long log messages
- Empty inputs
- Invalid patterns

## Running Tests

```bash
# Run tests once
pnpm test:run

# Run tests in watch mode
pnpm test

# Run tests with coverage
pnpm test --coverage
```

## Test Structure

Tests are organized hierarchically using `describe` blocks:

```
Log Parser
├── uuidRegex
├── jidRegex
├── extractLogInfo
│   ├── Background Job Logs
│   ├── Web Request Logs
│   └── System Logs
├── parseLogLine
├── parseLogLines
├── isValidUuid
├── isValidJid
├── Time-based UUID generation
└── Edge Cases and Error Handling
```

## Key Behavioral Notes

1. **Title Generation**: The parser filters out words that are:
   - 2 characters or less
   - Numbers only
   - Exact log level matches (INFO, DEBUG, etc. without punctuation)
   - Bracketed content

2. **UUID Generation**:
   - System logs without UUIDs get time-based UUIDs
   - System logs within 2 seconds share the same UUID for grouping

3. **Log Classification**:
   - Background jobs: Identified by `class=X jid=Y` pattern
   - Web requests: Identified by HTTP method + path pattern
   - System logs: Everything else

4. **Success Detection**:
   - Background jobs: `INFO: done` = success, `ERROR:`/`FATAL:` = failure
   - Web requests: Status codes 200-399 = success
   - System logs: `ERROR`/`FATAL` levels = failure

## Maintenance

When modifying the log parser:

1. Update relevant test cases to match new behavior
2. Add new test cases for new functionality
3. Ensure edge cases are covered
4. Run the full test suite before committing changes

The test suite aims for comprehensive coverage to catch regressions and ensure the parser handles real-world log data reliably.
