declare module '*.json' {
  const value: any;
  export default value;
}

interface Window {
  api?: {
    invoke(channel: string, ...args: any[]): Promise<any>;
    on?(channel: string, listener: (...args: any[]) => void): () => void;
  };
}
