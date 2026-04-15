import { parentPort, workerData } from 'node:worker_threads';
import { runLogSearchTask } from './logSearchRunner.js';

if (!parentPort) {
  throw new Error('logSearchWorker must run inside a worker thread');
}

let cancelled = false;

parentPort.on('message', (message) => {
  if (message?.type === 'cancel') {
    cancelled = true;
  }
});

const run = async () => {
  try {
    const result = await runLogSearchTask(
      workerData,
      {
        onStatus: (payload) => {
          parentPort.postMessage({
            type: 'status',
            payload
          });
        },
        onResults: (payload) => {
          parentPort.postMessage({
            type: 'results',
            payload
          });
        },
        onRequestIndexRefresh: (logFilePath) => {
          parentPort.postMessage({
            type: 'refresh-index',
            logFilePath
          });
        },
        isCancelled: () => cancelled
      }
    );

    parentPort.postMessage({
      type: 'done',
      payload: result
    });
  } catch (error) {
    parentPort.postMessage({
      type: 'status',
      payload: {
        searchId: workerData.searchId,
        query: workerData.query,
        backend: null,
        status: 'error',
        bytesProcessed: 0,
        totalBytes: 0,
        progressPercent: 0,
        matchedLines: 0,
        shownGroups: 0,
        scannedLines: 0,
        truncated: false,
        error: error.message
      }
    });
    parentPort.postMessage({
      type: 'done',
      payload: {
        success: false,
        message: error.message,
        searchId: workerData.searchId,
        query: workerData.query
      }
    });
  }
};

void run();
