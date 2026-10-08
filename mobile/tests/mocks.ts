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
  modificationTime: number;
  text: () => Promise<string>;
  write: (data: string) => void;
  create: () => void;
  delete: () => void;
}

/** Build the module factory for `expo-file-system`. */
export function fileSystemMock() {
  const files = new Map<string, FakeFileLike>();
  const directories = new Set<string>();
  function join(parts: ({ uri?: string } | string)[]): string {
    const uris = parts.map((part) => typeof part === 'string' ? part : part?.uri ?? '');
    const [first = '', ...rest] = uris;
    const tail = rest.map((piece) => piece.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/');
    return first.replace(/\/+$/, '') + (tail ? `/${tail}` : '');
  }
  class Directory {
    uri: string;
    constructor(...parts: ({ uri?: string } | string)[]) { this.uri = join(parts); }
    get exists() { return directories.has(this.uri); }
    create() { directories.add(this.uri); }
    delete() {
      for (const key of [...directories]) if (key === this.uri || key.startsWith(this.uri + '/')) directories.delete(key);
      for (const key of [...files.keys()]) if (key.startsWith(this.uri + '/')) files.delete(key);
    }
    list(): (File | Directory)[] {
      return [...files.values()].filter(file => file.exists && file.uri.startsWith(this.uri + '/') && !file.uri.slice(this.uri.length + 1).includes('/')).map(file => new File(file.uri));
    }
    get size() {
      let total = 0;
      for (const [key, file] of files) if (key.startsWith(this.uri + '/') && file.exists) total += file.size;
      return total;
    }
  }
  class File {
    static failWrite = false;
    static failMove = false;
    static pickFileAsync = jest.fn(async () => ({ result: undefined as File | undefined }));
    uri: string;
    constructor(...parts: ({ uri?: string } | string)[]) {
      this.uri = join(parts);
      if (!files.has(this.uri)) {
        const uri = this.uri;
        files.set(uri, {
          uri, name: uri.split('/').pop() ?? 'file', exists: false, size: 0, content: '', modificationTime: Date.now(),
          text: async () => files.get(uri)?.content ?? '',
          write(data: string) {
            if (File.failWrite) throw new Error('disk full');
            const entry = files.get(uri)!;
            entry.content = data; entry.size = data.length; entry.exists = true; entry.modificationTime = Date.now();
          },
          create() { files.get(uri)!.exists = true; },
          delete() { const entry = files.get(uri)!; entry.exists = false; entry.size = 0; entry.content = ''; },
        });
      }
    }
    get entry() { return files.get(this.uri)!; }
    get name() { return this.entry.name; }
    get exists() { return this.entry.exists; }
    get size() { return this.entry.size; }
    get modificationTime() { return this.entry.modificationTime; }
    get parentDirectory() { return new Directory(this.uri.replace(/\/[^/]*$/, '')); }
    text() { return this.entry.text(); }
    write(data: string) { this.entry.write(data); }
    create() { this.entry.create(); }
    delete() { this.entry.delete(); }
    open() {
      return { readBytes: (size: number) => Uint8Array.from([...this.entry.content.slice(0, size)].map(c => c.charCodeAt(0))),
        close: () => {} };
    }
    async copy(destination: { uri: string }) {
      const target = new File(destination);
      target.write(this.entry.content);
      target.entry.size = this.size;
    }
    async move(destination: { uri: string }) {
      if (File.failMove) throw new Error('move failed');
      await this.copy(destination);
      this.delete();
      this.uri = destination.uri; // SDK 57 relocations mutate the File object.
    }
  }
  class DownloadTask {
    static behaviour: 'ok' | 'paused' | 'throw' = 'ok';
    static bytes = 200_000;
    static header = '\xff\xd8\xff\xe0';
    static gate: Promise<void> | null = null;
    static calls: { url: string; destination: string; released: boolean; canceled: boolean }[] = [];
    entry: (typeof DownloadTask.calls)[number];
    constructor(public url: string, public destination: File, public options?: Record<string, unknown>) {
      this.entry = { url, destination: destination.uri, released: false, canceled: false };
      DownloadTask.calls.push(this.entry);
    }
    async downloadAsync(): Promise<File | null> {
      await DownloadTask.gate;
      if (DownloadTask.behaviour === 'throw') { this.destination.write('partial'); throw new Error('network down'); }
      if (DownloadTask.behaviour === 'paused') { this.destination.write('partial'); return null; }
      const onProgress = this.options?.onProgress as ((value: { bytesWritten: number; totalBytes: number }) => void) | undefined;
      onProgress?.({ bytesWritten: DownloadTask.bytes, totalBytes: DownloadTask.bytes });
      if ((this.options?.signal as AbortSignal)?.aborted || this.entry.canceled) throw new Error('canceled');
      this.destination.write(DownloadTask.header + 'x'.repeat(Math.max(0, Math.min(DownloadTask.bytes, 32) - DownloadTask.header.length)));
      this.destination.entry.size = DownloadTask.bytes;
      return this.destination;
    }
    release() { this.entry.released = true; }
    cancel() { this.entry.canceled = true; }
  }
  return {
    File, Directory, DownloadTask,
    Paths: { cache: { uri: 'file:///cache' }, document: { uri: 'file:///documents' }, availableDiskSpace: 1024 * 1024 * 1024 },
    __files: files, __directories: directories,
    __writeFile(uri: string, content: string) { const file = new File(uri); file.write(content); return file; },
    __reset() {
      files.clear(); directories.clear(); directories.add('file:///cache'); directories.add('file:///documents');
      DownloadTask.behaviour = 'ok'; DownloadTask.bytes = 200_000; DownloadTask.header = '\xff\xd8\xff\xe0';
      DownloadTask.gate = null; DownloadTask.calls = []; File.failWrite = false; File.failMove = false;
      File.pickFileAsync.mockImplementation(async () => ({ result: undefined }));
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
      validateImage: jest.fn(async () => ({ valid: true, width: 3840, height: 2160 })),
      isSupported: jest.fn(() => true),
      supportsSeparateLockScreen: jest.fn(() => true),
      setWallpaper: jest.fn(async () => ({ success: true, target: 'home', width: 3840, height: 2160 })),
    },
    isNativeWallpaperAvailable: true,
  };
}
