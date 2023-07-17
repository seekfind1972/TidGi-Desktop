/* eslint-disable @typescript-eslint/no-misused-promises */
import 'source-map-support/register';
import type { LoadConfig as LLamaLoadConfig } from 'llama-node/dist/llm/llama-cpp';
import inspector from 'node:inspector';
import { Observable } from 'rxjs';
import { expose } from 'threads/worker';
import { ILanguageModelWorkerResponse } from './interface';

const DEFAULT_TIMEOUT_DURATION = 1000 * 30;
function runLLama(
  options: { conversationID: string; modelPath: string; openDebugger?: boolean; prompt: string },
): Observable<ILanguageModelWorkerResponse> {
  const { conversationID, modelPath, prompt, openDebugger } = options;
  if (openDebugger === true) {
    inspector.open();
    inspector.waitForDebugger();
    // eslint-disable-next-line no-debugger
    debugger;
  }
  const loggerCommonMeta = { level: 'info' as const, meta: { function: 'llmWorker.runLLama' }, id: conversationID };
  return new Observable<ILanguageModelWorkerResponse>((subscriber) => {
    void (async function runLLamaObservableIIFE() {
      try {
        subscriber.next({ message: 'preparing instance and config', ...loggerCommonMeta });
        const { LLM } = await import('llama-node');
        // use dynamic import cjs version to fix https://github.com/andywer/threads.js/issues/478
        const { LLamaCpp } = await import('llama-node/dist/llm/llama-cpp.cjs');
        const llama = new LLM(LLamaCpp);
        const config: LLamaLoadConfig = {
          modelPath,
          enableLogging: true,
          nCtx: 1024,
          seed: 0,
          f16Kv: false,
          logitsAll: false,
          vocabOnly: false,
          useMlock: false,
          embedding: false,
          useMmap: true,
          nGpuLayers: 0,
        };
        subscriber.next({ message: 'loading config', ...loggerCommonMeta, meta: { config, ...loggerCommonMeta.meta } });
        await llama.load(config);
        let respondTimeout: NodeJS.Timeout | undefined;
        const abortController = new AbortController();
        const updateTimeout = () => {
          clearTimeout(respondTimeout);
          respondTimeout = setTimeout(() => {
            abortController.abort();
            subscriber.complete();
          }, DEFAULT_TIMEOUT_DURATION);
        };
        updateTimeout();
        subscriber.next({ message: 'ready to createCompletion', ...loggerCommonMeta });
        await llama.createCompletion(
          {
            nThreads: 4,
            nTokPredict: 2048,
            topK: 40,
            topP: 0.1,
            temp: 0.2,
            // repeatPenalty: 1,
            prompt,
          },
          (response) => {
            const { completed, token } = response;
            updateTimeout();
            subscriber.next({ type: 'result', token, id: conversationID });
            if (completed) {
              clearTimeout(respondTimeout);
              subscriber.complete();
            }
          },
          abortController.signal,
        );
        subscriber.next({ message: 'createCompletion completed', ...loggerCommonMeta });
      } catch (error) {
        if (error instanceof Error) {
          subscriber.next({ level: 'error', error, id: conversationID });
        } else {
          subscriber.next({ level: 'error', error: new Error(String(error)), id: conversationID });
        }
      }
    })();
  });
}

const llmWorker = { runLLama };
export type LLMWorker = typeof llmWorker;
expose(llmWorker);
