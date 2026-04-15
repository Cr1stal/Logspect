import { parentPort, workerData } from 'node:worker_threads';
import { runLogIndexTask } from './logIndex.js';

if (!parentPort) {
  throw new Error('logIndexWorker must run inside a worker thread');
}

let cancelled = false;

parentPort.on('message', (message) => {
  if (message?.type === 'cancel') {
    cancelled = true;
  }
});

const run = async () => {
  try {
    const result = await runLogIndexTask(
      workerData,
      {
        onStatus: (payload) => {
          parentPort.postMessage({
            type: 'status',
            payload
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
        logFilePath: workerData.logFilePath,
        dbPath: workerData.dbPath,
        status: 'error',
        progressPercent: 0,
        bytesIndexed: 0,
        totalBytes: workerData.statsSnapshot?.size ?? 0,
        indexedLines: 0,
        backend: 'sqlite',
        error: error.message
      }
    });
    parentPort.postMessage({
      type: 'done',
      payload: {
        success: false,
        message: error.message
      }
    });
  }
};

void run();
