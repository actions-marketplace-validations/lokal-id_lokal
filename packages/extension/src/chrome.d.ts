// The few extension APIs Lokal uses, typed by hand instead of adding @types/chrome as a dependency.
declare namespace chrome {
  namespace runtime {
    interface MessageSender {
      tab?: { id?: number };
      id?: string;
    }
    const id: string;
    const lastError: { message?: string } | undefined;
    function sendMessage<T = unknown>(message: unknown): Promise<T>;
    function getManifest(): { version: string; name: string };
    const onMessage: {
      addListener(
        callback: (message: any, sender: MessageSender, sendResponse: (response?: unknown) => void) => boolean | void,
      ): void;
    };
  }
  namespace storage {
    interface StorageArea {
      get(keys?: string | string[] | null): Promise<Record<string, any>>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
      clear(): Promise<void>;
    }
    const local: StorageArea;
    const session: StorageArea;
    const onChanged: {
      addListener(callback: (changes: Record<string, { oldValue?: any; newValue?: any }>, areaName: string) => void): void;
    };
  }
  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
    }
    function query(query: { active?: boolean; currentWindow?: boolean }): Promise<Tab[]>;
    function sendMessage(tabId: number, message: unknown): Promise<unknown>;
  }
  namespace action {
    function setBadgeText(details: { text: string; tabId?: number }): Promise<void>;
    function setBadgeBackgroundColor(details: { color: string; tabId?: number }): Promise<void>;
  }
  namespace i18n {
    function getUILanguage(): string;
  }
}
