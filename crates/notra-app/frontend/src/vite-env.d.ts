/// <reference types="vite/client" />
/// <reference path="../vendor/marktext-muya/src/types/global.d.ts" />
/// <reference path="../vendor/marktext-muya/src/types/index.d.ts" />

declare module "*?worker" {
  const WorkerFactory: {
    new (): Worker;
  };
  export default WorkerFactory;
}

declare module "monaco-editor/esm/vs/editor/browser/controller/editContext/clipboardUtils.js" {
  export const InMemoryClipboardMetadataManager: {
    INSTANCE: {
      get(text: string): {
        isFromEmptySelection?: boolean;
        multicursorText?: string[] | null;
        mode?: string | null;
      } | null;
    };
  };
}

declare module "monaco-editor/esm/vs/editor/browser/controller/editContext/native/nativeEditContextRegistry.js" {
  export const NativeEditContextRegistry: {
    get(editorId: string): { onWillCopy(): void } | undefined;
  };
}
