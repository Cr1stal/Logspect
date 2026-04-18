import fs from 'fs';

const findNextLineBreak = (content) => {
  const newlineIndex = content.indexOf('\n');
  const carriageReturnIndex = content.indexOf('\r');

  if (newlineIndex === -1 && carriageReturnIndex === -1) {
    return null;
  }

  if (newlineIndex === -1) {
    return {
      index: carriageReturnIndex,
      separator: '\r'
    };
  }

  if (carriageReturnIndex === -1 || newlineIndex < carriageReturnIndex) {
    const separator = newlineIndex > 0 && content[newlineIndex - 1] === '\r'
      ? '\r\n'
      : '\n';
    const index = separator === '\r\n' ? newlineIndex - 1 : newlineIndex;

    return {
      index,
      separator
    };
  }

  return {
    index: carriageReturnIndex,
    separator: '\r'
  };
};

export async function* streamFileLineRecords(
  filePath,
  {
    startByte = 0,
    endByte = undefined,
    encoding = 'utf8',
    highWaterMark = 256 * 1024,
    startLineNumber = 1,
    skipLeadingPartialLine = false
  } = {}
) {
  const stream = fs.createReadStream(filePath, {
    start: startByte,
    ...(Number.isInteger(endByte) ? { end: endByte } : {}),
    encoding,
    highWaterMark
  });

  let buffer = '';
  let nextByteStart = startByte;
  let nextLineNumber = startLineNumber;
  let shouldSkipLeadingLine = skipLeadingPartialLine;

  try {
    for await (const chunk of stream) {
      buffer += chunk;

      while (true) {
        const lineBreak = findNextLineBreak(buffer);
        if (!lineBreak) {
          break;
        }

        const rawText = buffer.slice(0, lineBreak.index);
        const sliceWithSeparator = buffer.slice(0, lineBreak.index + lineBreak.separator.length);
        const rawByteLength = Buffer.byteLength(rawText, encoding);
        const consumedByteLength = Buffer.byteLength(sliceWithSeparator, encoding);
        const record = {
          rawText,
          lineNumber: nextLineNumber,
          byteStart: nextByteStart,
          byteEnd: nextByteStart + rawByteLength
        };

        nextByteStart += consumedByteLength;
        nextLineNumber += 1;
        buffer = buffer.slice(lineBreak.index + lineBreak.separator.length);

        if (shouldSkipLeadingLine) {
          shouldSkipLeadingLine = false;
          continue;
        }

        yield record;
      }
    }

    if (buffer.length > 0 && !shouldSkipLeadingLine) {
      yield {
        rawText: buffer,
        lineNumber: nextLineNumber,
        byteStart: nextByteStart,
        byteEnd: nextByteStart + Buffer.byteLength(buffer, encoding)
      };
    }
  } finally {
    stream.destroy();
  }
}
