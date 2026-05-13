import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Y from "yjs";

const destroyMock = vi.fn();
const setLocalStateFieldMock = vi.fn();

const providerInstances: Array<{ config: Record<string, unknown>; awareness: { setLocalStateField: typeof setLocalStateFieldMock } }> = [];

vi.mock("@hocuspocus/provider", () => ({
  HocuspocusProvider: vi.fn().mockImplementation((config: Record<string, unknown>) => {
    const instance = {
      config,
      awareness: { setLocalStateField: setLocalStateFieldMock },
      destroy: destroyMock,
    };
    providerInstances.push(instance);
    return instance;
  }),
}));

beforeEach(() => {
  destroyMock.mockClear();
  setLocalStateFieldMock.mockClear();
  providerInstances.length = 0;
});

describe("bindCollab", () => {
  it("creates a HocuspocusProvider with the shared Y.Doc", async () => {
    const { bindCollab } = await import("../binding");
    const ydoc = new Y.Doc();
    const binding = bindCollab({
      ydoc,
      url: "ws://localhost:3004",
      name: "doc-1",
      token: "tok",
    });

    expect(providerInstances).toHaveLength(1);
    expect(providerInstances[0].config.url).toBe("ws://localhost:3004");
    expect(providerInstances[0].config.name).toBe("doc-1");
    expect(providerInstances[0].config.document).toBe(ydoc);
    expect(providerInstances[0].config.token).toBe("tok");
    binding.destroy();
  });

  it("propagates user awareness when provided", async () => {
    const { bindCollab } = await import("../binding");
    bindCollab({
      ydoc: new Y.Doc(),
      url: "ws://x",
      name: "n",
      user: { name: "Rafael", color: "#ff0" },
    });
    expect(setLocalStateFieldMock).toHaveBeenCalledWith("user", {
      name: "Rafael",
      color: "#ff0",
    });
  });

  it("destroys the provider exactly once", async () => {
    const { bindCollab } = await import("../binding");
    const binding = bindCollab({
      ydoc: new Y.Doc(),
      url: "ws://x",
      name: "n",
    });
    binding.destroy();
    binding.destroy();
    expect(destroyMock).toHaveBeenCalledTimes(1);
  });

  it("forwards onStatus callbacks", async () => {
    const { bindCollab } = await import("../binding");
    const onStatus = vi.fn();
    bindCollab({
      ydoc: new Y.Doc(),
      url: "ws://x",
      name: "n",
      onStatus,
    });
    const cb = providerInstances[0].config.onStatus as (
      arg: { status: string },
    ) => void;
    cb({ status: "connected" });
    expect(onStatus).toHaveBeenCalledWith("connected");
  });
});
