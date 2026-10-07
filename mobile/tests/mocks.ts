/**
 * Shared test doubles.
 *
 * `jest.mock` factories are hoisted above imports, so the doubles live here and are wired up
 * per test file with `jest.requireMock(...)`.  Keeping them in one place means the file
 * system behaves the same in every test.
 */
import { jest } from '@jest/globals';

export interface FakeFileLike {
  uri: string;
  name: string;
  exists: boolean;
  size: number;
  /** Raw bytes/characters of the file – internal to the double, used to simulate JSON files. */
  content: string;
  text: () => Promise<string>;
  write: (data: string) => void;
  create: () => void;
  delete: () => void;
}

/** Build the module factory for `expo-file-system`. */
export function fileSystemMock() {
  const files = new Map<string, FakeFileLike>();
  const directories = new Set<string>();

  class Directory {
    uri: string;
    constructor(...parts: ({ uri?: string } | string)[]) {
      this.uri = join(parts);
      directories.add(this.uri);
    }
    get exists(): boolean {
      return directories.has(this.uri);
    }
    create(): void {
      directories.add(this.uri);
    }
    delete(): void {
      directories.delete(this.uri);
      for (const key of [...files.keys()]) if (key.startsWith(this.uri)) files.delete(key);
    }
    get size(): number {
      let total = 0;
      for (const [key, file] of files) if (key.startsWith(this.uri)) total += file.size;
      return total;
    }
  }

  class File {
    uri: string;
    constructor(...parts: ({ uri?: string } | string)[]) {
      this.uri = join(parts);
      if (!files.has(this.uri)) {
        const uri = this.uri;
        files.set(uri, {
          uri,
          name: uri.split('/').pop() ?? 'file',
          exists: false,
          size: 0,
          content: '',
          text: async () => files.get(uri)?.content ?? '',
          write(data: string) {
            const entry = files.get(uri);
            if (!entry) return;
            entry.content = data;
            entry.size = data.length;
            entry.exists = true;
          },
          create() {
            const entry = files.get(uri);
            if (entry) entry.exists = true;
          },
          delete() {
            const entry = files.get(uri);
            if (entry) {
              entry.exists = false;
              entry.size = 0;
              entry.content = '';
            }
          },
        });
      }
    }
    private get entry(): FakeFileLike {
      return files.get(this.uri)!;
    }
    get name(): string {
      return this.entry.name;
    }
    get exists(): boolean {
      return this.entry.exists;
    }
    get size(): number {
      return this.entry.size;
    }
    text(): Promise<string> {
      return Promise.resolve(this.entry.content);
    }
    write(data: string): void {
      this.entry.write(data);
    }
    create(): void {
      this.entry.create();
    }
    delete(): void {
      this.entry.delete();
    }
  }

  class DownloadTask {
    static behaviour: 'ok' | 'paused' | 'throw' = 'ok';
    static bytes = 200_000;
    static calls: { url: string; destination: string }[] = [];
    destination: FakeFileLike;
    constructor(public url: string, destination: { uri: string }, public options?: Record<string, unknown>) {
      this.destination = files.get(destination.uri) as FakeFileLike;
      DownloadTask.calls.push({ url, destination: destination.uri });
    }
    async downloadAsync(): Promise<unknown> {
      if (DownloadTask.behaviour === 'throw') throw new Error('network down');
      if (DownloadTask.behaviour === 'paused') return null;
      this.destination.size = DownloadTask.bytes;
      this.destination.exists = true;
      this.destination.content = 'x'.repeat(Math.min(DownloadTask.bytes, 32));
      return this.destination;
    }
    release(): void {}
    cancel(): void {}
  }

  /** Join path parts while preserving a `file://` (or `content://`) prefix. */
  function join(parts: ({ uri?: string } | string)[]): string {
    const uris = parts.map((part) => (typeof part === 'string' ? part : part?.uri ?? ''));
    const [first = '', ...rest] = uris;
    const base = first.replace(/\/+$/, '');
    const tail = rest
      .map((piece) => piece.replace(/^\/+|\/+$/g, ''))
      .filter(Boolean)
      .join('/');
    return tail ? `${base}/${tail}` : base;
  }

  return {
    File,
    Directory,
    DownloadTask,
    Paths: { cache: { uri: 'file:///cache' }, document: { uri: 'file:///documents' } },
    __files: files,
    __directories: directories,
    /** Put a file on the fake disk (used to simulate a cached catalog). */
    __writeFile(uri: string, content: string) {
      const file = new File(uri);
      file.write(content);
      return file;
    },
    __reset() {
      files.clear();
      directories.clear();
      DownloadTask.behaviour = 'ok';
      DownloadTask.bytes = 200_000;
      DownloadTask.calls = [];
    },
  };
}

/** A reset-able double of `expo-media-library`. */
export function mediaLibraryMock() {
  const defaults = () => ({
    granted: true,
    status: 'granted' as const,
  });
  return {
    Album: {
      get: jest.fn(async () => null),
      create: jest.fn(async () => ({ id: 'album-1' })),
      delete: jest.fn(async () => undefined),
    },
    Asset: {
      create: jest.fn(async () => ({ id: 'asset-1' })),
      delete: jest.fn(async () => undefined),
    },
    getPermissionsAsync: jest.fn(async () => defaults()),
    requestPermissionsAsync: jest.fn(async () => defaults()),
    /** Put every function back to its happy-path implementation. */
    __reset(this: Record<string, unknown>) {
      (this.Album as any).get.mockImplementation(async () => null);
      (this.Album as any).create.mockImplementation(async () => ({ id: 'album-1' }));
      (this.Asset as any).create.mockImplementation(async () => ({ id: 'asset-1' }));
      (this.getPermissionsAsync as jest.Mock).mockImplementation(async () => defaults());
      (this.requestPermissionsAsync as jest.Mock).mockImplementation(async () => defaults());
    },
  };
}

/** The shape `media.ts` and `rotation.ts` expect from `expo-modules-core`. */
export function nativeWallpaperMock() {
  return {
    nativeWallpaper: {
      isSupported: jest.fn(() => true),
      supportsSeparateLockScreen: jest.fn(() => true),
      setWallpaper: jest.fn(async () => ({ success: true, target: 'home', width: 3840, height: 2160 })),
    },
    isNativeWallpaperAvailable: true,
  };
}
