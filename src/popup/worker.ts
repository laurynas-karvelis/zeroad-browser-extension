export const worker = {
  sendCommand<T>(command: string): Promise<T> {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ command }, (response) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
          return;
        }

        resolve(response as T);
      });
    });
  },

  on<T>(event: string, callback: (data: T) => unknown) {
    chrome.runtime.onMessage.addListener(({ event: receivedEvent, data }) => {
      if (receivedEvent === event) return callback(data as T);
    });

    return this;
  },
};
