import { AsyncLocalStorage } from 'async_hooks';

export const logStorage = new AsyncLocalStorage<{
  verbose: boolean;
}>();

export const setLogContext = (verbose: boolean) => {
  logStorage.enterWith({ verbose });
};

export const getLogContext = () => {
  return logStorage.getStore();
};

export const log = (message: string) => {
  const context = getLogContext();
  if (context?.verbose) {
    console.log(message);
  }
};
