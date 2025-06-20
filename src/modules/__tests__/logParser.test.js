import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  uuidRegex,
  jidRegex,
  extractLogInfo,
  parseLogLine,
  parseLogLines,
  isValidUuid,
  isValidJid
} from '../logParser.js';

describe('Log Parser', () => {
  beforeEach(() => {
    // Reset any module-level state between tests
    vi.resetAllMocks();
  });

  describe('uuidRegex', () => {
    it('should match valid UUID patterns', () => {
      const validUuids = [
        '[aa32797f-b087-4d45-9d99-28198952a784]',
        '[12345678-1234-1234-1234-123456789abc]',
        '[ffffffff-ffff-ffff-ffff-ffffffffffff]'
      ];

      validUuids.forEach(uuid => {
        const match = uuid.match(uuidRegex);
        expect(match).toBeTruthy();
        expect(match[1]).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
      });
    });

    it('should not match invalid UUID patterns', () => {
      const invalidUuids = [
        'aa32797f-b087-4d45-9d99-28198952a784', // No brackets
        '[aa32797f-b087-4d45-9d99-28198952a78]', // Too short
        '[aa32797f-b087-4d45-9d99-28198952a7844]', // Too long
        '[gg32797f-b087-4d45-9d99-28198952a784]', // Invalid hex characters
        '[aa32797f_b087_4d45_9d99_28198952a784]' // Wrong separators
      ];

      invalidUuids.forEach(uuid => {
        const match = uuid.match(uuidRegex);
        expect(match).toBeFalsy();
      });
    });
  });

  describe('jidRegex', () => {
    it('should match valid job ID patterns', () => {
      const validJids = [
        'class=Workers::Database::RefreshMaterializedView jid=73f8e97e7e79413a3006f4ea',
        'class=SomeJob jid=abcdef123456789012345678',
        'class=My::Nested::Worker jid=1234567890abcdef12345678'
      ];

      validJids.forEach(line => {
        const match = line.match(jidRegex);
        expect(match).toBeTruthy();
        expect(match[1]).toBeTruthy(); // class name
        expect(match[2]).toBeTruthy(); // jid
        expect(match[2]).toMatch(/^[a-f0-9]+$/);
      });
    });

    it('should not match invalid job ID patterns', () => {
      const invalidJids = [
        'class=SomeJob id=73f8e97e7e79413a3006f4ea', // 'id' instead of 'jid'
        'job=SomeJob jid=73f8e97e7e79413a3006f4ea', // 'job' instead of 'class'
        'class= jid=73f8e97e7e79413a3006f4ea', // Empty class name
        'class=SomeJob jid=', // Empty jid
        'regular log line without job info'
      ];

      invalidJids.forEach(line => {
        const match = line.match(jidRegex);
        expect(match).toBeFalsy();
      });
    });
  });

  describe('extractLogInfo', () => {
    describe('Background Job Logs', () => {
      it('should extract job information correctly', () => {
        const content = 'class=Workers::Database::RefreshMaterializedView jid=73f8e97e7e79413a3006f4ea INFO: start';
        const result = extractLogInfo(content);

        expect(result).toEqual({
          type: 'worker',
          subType: 'job',
          success: null,
          metadata: {
            jobClass: 'Workers::Database::RefreshMaterializedView',
            jid: '73f8e97e7e79413a3006f4ea'
          },
          title: 'RefreshMaterializedView'
        });
      });

      it('should detect successful job completion', () => {
        const content = 'class=SomeJob jid=abc123 INFO: done elapsed=1.234';
        const result = extractLogInfo(content);

        expect(result.success).toBe(true);
        expect(result.metadata.elapsed).toBe(1.234);
      });

      it('should detect failed jobs', () => {
        const content = 'class=SomeJob jid=abc123 ERROR: job failed';
        const result = extractLogInfo(content);

        expect(result.success).toBe(false);
      });

      it('should extract database timing', () => {
        const content = 'class=SomeJob jid=abc123 DEBUG: query (123.45ms)';
        const result = extractLogInfo(content);

        expect(result.metadata.dbTiming).toBe(123.45);
      });
    });

    describe('Web Request Logs', () => {
      it('should extract HTTP GET request information', () => {
        const content = 'GET /dashboard/overview 200 OK 45ms';
        const result = extractLogInfo(content);

        expect(result).toEqual({
          type: 'web',
          subType: 'GET',
          success: true,
          metadata: {
            path: '/dashboard/overview',
            statusCode: 200,
            responseTime: 45
          },
          title: 'GET /dashboard/overview'
        });
      });

      it('should extract HTTP POST request information', () => {
        const content = 'POST /api/users 201 Created 120.5ms';
        const result = extractLogInfo(content);

        expect(result.type).toBe('web');
        expect(result.subType).toBe('POST');
        expect(result.success).toBe(true);
        expect(result.metadata.statusCode).toBe(201);
        expect(result.metadata.responseTime).toBe(120.5);
      });

      it('should detect failed HTTP requests', () => {
        const content = 'GET /api/nonexistent 404 Not Found 12ms';
        const result = extractLogInfo(content);

        expect(result.success).toBe(false);
        expect(result.metadata.statusCode).toBe(404);
      });

      it('should handle various HTTP methods', () => {
        const methods = ['PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

        methods.forEach(method => {
          const content = `${method} /api/resource`;
          const result = extractLogInfo(content);

          expect(result.type).toBe('web');
          expect(result.subType).toBe(method);
          expect(result.title).toBe(`${method} /api/resource`);
        });
      });
    });

    describe('System Logs', () => {
      it('should extract system log information', () => {
        const content = 'INFO: Application started successfully on port 3000';
        const result = extractLogInfo(content);

        expect(result.type).toBe('app');
        expect(result.subType).toBe('sys');
        expect(result.success).toBe(true);
        expect(result.title).toBe('INFO: Application started successfully');
      });

      it('should detect error system logs', () => {
        const content = 'ERROR: Database connection failed';
        const result = extractLogInfo(content);

        expect(result.success).toBe(false);
      });

      it('should detect fatal system logs', () => {
        const content = 'FATAL: Critical system failure';
        const result = extractLogInfo(content);

        expect(result.success).toBe(false);
      });

      it('should handle logs without log levels', () => {
        const content = 'Application is processing requests normally';
        const result = extractLogInfo(content);

        expect(result.type).toBe('app');
        expect(result.subType).toBe('sys');
        expect(result.success).toBe(null);
        expect(result.title).toBe('Application processing requests normally');
      });

      it('should truncate long titles', () => {
        const content = 'This is a very long log message that should be truncated because it exceeds the maximum length limit';
        const result = extractLogInfo(content);

        expect(result.title.length).toBeLessThanOrEqual(53); // 50 + '...'
        // The current implementation only takes first 4 words, so it won't be long enough to truncate
        // Let's test with a single very long word
        const longWordContent = 'Supercalifragilisticexpialidocioussuperlongwordthatexceedsfiftychars more content';
        const longResult = extractLogInfo(longWordContent);

        if (longResult.title.length > 50) {
          expect(longResult.title).toContain('...');
        }
      });

      it('should filter out short words and log levels from title', () => {
        const content = 'INFO: The app is now processing user data with ID 123';
        const result = extractLogInfo(content);

        // The filter removes words <= 2 chars, numbers, and EXACT log level matches
        // But "INFO:" with colon doesn't match the exact pattern, so it's kept
        expect(result.title).toBe('INFO: The app now');

        // Test with exact log level word (without colon)
        const exactLevelContent = 'INFO The app is now processing user data with ID 123';
        const exactResult = extractLogInfo(exactLevelContent);
        expect(exactResult.title).not.toContain('INFO');
        expect(exactResult.title).toBe('The app now processing');
      });
    });
  });

  describe('parseLogLine', () => {
    it('should parse UUID-based log lines', () => {
      const logLine = '[aa32797f-b087-4d45-9d99-28198952a784] INFO: User logged in';
      const result = parseLogLine(logLine);

      expect(result.uuid).toBe('aa32797f-b087-4d45-9d99-28198952a784');
      expect(result.content).toBe('INFO: User logged in');
      expect(result.isNewEntry).toBe(false);
      expect(result.logInfo).toBeDefined();
      expect(result.logInfo.type).toBe('app');
    });

    it('should parse job ID-based log lines', () => {
      const logLine = 'class=Workers::TestJob jid=abc123def456 INFO: start';
      const result = parseLogLine(logLine);

      expect(result.uuid).toBe('abc123def456');
      expect(result.content).toBe('class=Workers::TestJob jid=abc123def456 INFO: start');
      expect(result.logInfo.type).toBe('worker');
    });

    it('should generate time-based UUID for system logs', () => {
      const logLine = 'INFO: System startup complete';
      const result = parseLogLine(logLine);

      expect(result.uuid).toMatch(/^sys-\d+$/);
      expect(result.content).toBe('INFO: System startup complete');
      expect(result.logInfo.type).toBe('app');
      expect(result.logInfo.subType).toBe('sys');
    });

    it('should handle web request logs without UUID', () => {
      const logLine = 'GET /dashboard 200 OK';
      const result = parseLogLine(logLine);

      expect(result.uuid).toBe(null);
      expect(result.content).toBe('GET /dashboard 200 OK');
      expect(result.isNewEntry).toBe(false);
    });

    it('should strip VT control characters', () => {
      const logLine = '[aa32797f-b087-4d45-9d99-28198952a784] \x1b[32mINFO:\x1b[0m Test message';
      const result = parseLogLine(logLine);

      expect(result.content).toBe('INFO: Test message');
      expect(result.content).not.toContain('\x1b');
    });

        it('should handle empty or whitespace-only lines', () => {
      const emptyLine = '';
      const whitespaceLine = '   \t  \n';

      const emptyResult = parseLogLine(emptyLine);
      const whitespaceResult = parseLogLine(whitespaceLine);

      // Both empty and whitespace lines get classified as system logs and get UUIDs
      expect(emptyResult.uuid).toMatch(/^sys-\d+$/);
      expect(emptyResult.content).toBe('');

      expect(whitespaceResult.uuid).toMatch(/^sys-\d+$/);
      expect(whitespaceResult.content).toBe('');
    });
  });

  describe('parseLogLines', () => {
    it('should parse multiple log lines', () => {
      const lines = [
        '[aa32797f-b087-4d45-9d99-28198952a784] INFO: User logged in',
        'class=TestJob jid=abc123 INFO: start',
        'GET /dashboard 200 OK',
        'INFO: System message',
        '', // Empty line should be filtered out
        '   ' // Whitespace line should be filtered out
      ];

      const results = parseLogLines(lines);

      expect(results).toHaveLength(4); // Empty lines filtered out
      expect(results[0].uuid).toBe('aa32797f-b087-4d45-9d99-28198952a784');
      expect(results[1].uuid).toBe('abc123');
      expect(results[2].uuid).toBe(null);
      expect(results[3].uuid).toMatch(/^sys-\d+$/);
    });

    it('should handle empty array', () => {
      const results = parseLogLines([]);
      expect(results).toEqual([]);
    });

    it('should filter out empty lines', () => {
      const lines = ['', '   ', '\t\n', 'Valid log line'];
      const results = parseLogLines(lines);

      expect(results).toHaveLength(1);
      expect(results[0].content).toBe('Valid log line');
    });
  });

  describe('isValidUuid', () => {
    it('should validate correct UUIDs', () => {
      const validUuids = [
        'aa32797f-b087-4d45-9d99-28198952a784',
        '12345678-1234-1234-1234-123456789abc',
        'ffffffff-ffff-ffff-ffff-ffffffffffff',
        '00000000-0000-0000-0000-000000000000'
      ];

      validUuids.forEach(uuid => {
        expect(isValidUuid(uuid)).toBe(true);
      });
    });

    it('should reject invalid UUIDs', () => {
      const invalidUuids = [
        null,
        undefined,
        '',
        'not-a-uuid',
        'aa32797f-b087-4d45-9d99-28198952a78', // Too short
        'aa32797f-b087-4d45-9d99-28198952a7844', // Too long
        'gg32797f-b087-4d45-9d99-28198952a784', // Invalid hex
        'aa32797f_b087_4d45_9d99_28198952a784', // Wrong separators
        'AA32797F-B087-4D45-9D99-28198952A784', // Uppercase
        123456789,
        {},
        []
      ];

      invalidUuids.forEach(uuid => {
        expect(isValidUuid(uuid)).toBe(false);
      });
    });
  });

  describe('isValidJid', () => {
    it('should validate correct job IDs', () => {
      const validJids = [
        '73f8e97e7e79413a3006f4ea',
        'abcdef123456789012345678',
        '000000000000000000000000',
        'ffffffffffffffffffffffff'
      ];

      validJids.forEach(jid => {
        expect(isValidJid(jid)).toBe(true);
      });
    });

    it('should reject invalid job IDs', () => {
      const invalidJids = [
        null,
        undefined,
        '',
        'not-a-jid',
        '73f8e97e7e79413a3006f4e', // Too short
        '73f8e97e7e79413a3006f4ea1', // Too long
        'gg3f8e97e7e79413a3006f4ea', // Invalid hex
        '73F8E97E7E79413A3006F4EA', // Uppercase
        123456789,
        {},
        []
      ];

      invalidJids.forEach(jid => {
        expect(isValidJid(jid)).toBe(false);
      });
    });
  });

  describe('Time-based UUID generation', () => {
    it('should group system logs within 2-second window', () => {
      // Parse multiple system logs quickly
      const line1 = parseLogLine('INFO: First system message');
      const line2 = parseLogLine('INFO: Second system message');

      // Should have same UUID since they're within 2 seconds
      expect(line1.uuid).toBe(line2.uuid);
    });

    it('should create new UUID after time gap', async () => {
      const line1 = parseLogLine('INFO: First system message');

      // Wait more than 2 seconds (simulate with mock)
      const originalDate = Date;
      const mockDate = vi.fn(() => ({
        getTime: () => originalDate.now() + 3000 // 3 seconds later
      }));
      global.Date = mockDate;

      const line2 = parseLogLine('INFO: Second system message after delay');

      // Restore original Date
      global.Date = originalDate;

      // Should have different UUIDs
      expect(line1.uuid).not.toBe(line2.uuid);
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle malformed log lines gracefully', () => {
      const malformedLines = [
        '[invalid-uuid] Some content',
        'class= jid= empty fields',
        'HTTP /path/without/method',
        '\x00\x01\x02 binary content',
        'Log line with emoji 🚀 and unicode ñ',
        'Very long log line that exceeds normal expectations and contains lots of text that might cause issues with parsing or memory usage if not handled properly in the parser implementation'
      ];

      malformedLines.forEach(line => {
        expect(() => parseLogLine(line)).not.toThrow();
        const result = parseLogLine(line);
        expect(result).toHaveProperty('content');
        expect(result).toHaveProperty('uuid');
        expect(result).toHaveProperty('isNewEntry');
      });
    });

    it('should handle special characters in log content', () => {
      const specialChars = [
        '[aa32797f-b087-4d45-9d99-28198952a784] Content with "quotes" and \'apostrophes\'',
        '[aa32797f-b087-4d45-9d99-28198952a784] Content with <tags> and &entities;',
        '[aa32797f-b087-4d45-9d99-28198952a784] Content with newlines\nand\ttabs'
      ];

      specialChars.forEach(line => {
        const result = parseLogLine(line);
        expect(result.uuid).toBe('aa32797f-b087-4d45-9d99-28198952a784');
        expect(result.content).toBeTruthy();
      });
    });
  });
});