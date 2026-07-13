/// <reference types="vite/client" />
/// <reference path="../vendor/marktext-muya/src/types/global.d.ts" />
/// <reference path="../vendor/marktext-muya/src/types/index.d.ts" />

declare module "*?worker" {
  const WorkerFactory: {
    new (): Worker;
  };
  export default WorkerFactory;
}
