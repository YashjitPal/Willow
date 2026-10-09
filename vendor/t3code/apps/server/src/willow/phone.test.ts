import { afterEach, describe, expect, it, vi } from "@effect/vitest";

type Hub = typeof import("./phone.ts");

/** Each test gets a hub with no phones. */
const freshHub = async (): Promise<Hub> => {
  vi.resetModules();
  return import("./phone.ts");
};

const never = new Promise<void>(() => {});

afterEach(() => {
  vi.useRealTimers();
});

describe("the phone hub", () => {
  it("reports no phone, and refuses calls, before one connects", async () => {
    const hub = await freshHub();
    expect(hub.describePhone()).toEqual({ connected: false });
    await expect(hub.callPhone("phone_vibrate", {})).rejects.toThrow("No phone is connected");
  });

  it("hands a call to the phone's held poll and settles it with the phone's answer", async () => {
    const hub = await freshHub();
    hub.hello("phone-aaaaaaaa", {
      tools: ["phone_status", "phone_vibrate", "not_a_tool"],
      label: "Pixel",
    });
    expect(hub.describePhone()).toEqual({
      connected: true,
      label: "Pixel",
      tools: ["phone_status", "phone_vibrate"],
    });
    const poll = hub.poll("phone-aaaaaaaa", never);
    const result = hub.callPhone("phone_status", { detail: 1 });
    const calls = await poll;
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ tool: "phone_status", args: { detail: 1 } });
    expect(
      hub.settle("phone-aaaaaaaa", { id: calls[0]?.id, ok: true, result: { battery: 0.5 } }),
    ).toBe(true);
    await expect(result).resolves.toEqual({ battery: 0.5 });
  });

  it("keeps a call for the next poll when none is held", async () => {
    const hub = await freshHub();
    hub.hello("phone-aaaaaaaa", { tools: ["phone_vibrate"] });
    const result = hub.callPhone("phone_vibrate", {});
    const calls = await hub.poll("phone-aaaaaaaa", never);
    expect(calls.map((call) => call.tool)).toEqual(["phone_vibrate"]);
    hub.settle("phone-aaaaaaaa", { id: calls[0]?.id, ok: false, error: "Vibration is off." });
    await expect(result).rejects.toThrow("Vibration is off.");
  });

  it("refuses calls the phone's owner does not allow", async () => {
    const hub = await freshHub();
    hub.hello("phone-aaaaaaaa", { tools: [] });
    await expect(hub.callPhone("phone_vibrate", {})).rejects.toThrow("turned off agent access");
    hub.hello("phone-aaaaaaaa", { tools: ["phone_status"] });
    await expect(hub.callPhone("phone_photo", {})).rejects.toThrow("does not offer phone_photo");
  });

  it("ignores answers from another phone, or for no call", async () => {
    const hub = await freshHub();
    hub.hello("phone-aaaaaaaa", { tools: ["phone_vibrate"] });
    const result = hub.callPhone("phone_vibrate", {});
    const [call] = await hub.poll("phone-aaaaaaaa", never);
    expect(hub.settle("phone-bbbbbbbb", { id: call?.id, ok: true })).toBe(false);
    expect(hub.settle("phone-aaaaaaaa", { id: "no-such-call", ok: true })).toBe(false);
    expect(hub.settle("phone-aaaaaaaa", { id: call?.id, ok: true, result: { done: true } })).toBe(
      true,
    );
    await expect(result).resolves.toEqual({ done: true });
  });

  it("sends calls a closed poll took out with the next poll", async () => {
    const hub = await freshHub();
    hub.hello("phone-aaaaaaaa", { tools: ["phone_vibrate"] });
    const result = hub.callPhone("phone_vibrate", {});
    const taken = await hub.poll("phone-aaaaaaaa", never);
    hub.requeue("phone-aaaaaaaa", taken);
    const again = await hub.poll("phone-aaaaaaaa", never);
    expect(again.map((call) => call.id)).toEqual(taken.map((call) => call.id));
    hub.settle("phone-aaaaaaaa", { id: again[0]?.id, ok: true });
    await expect(result).resolves.toBeNull();
  });

  it("gives up on a phone that does not answer, and forgets one it stops hearing from", async () => {
    vi.useFakeTimers();
    const hub = await freshHub();
    hub.hello("phone-aaaaaaaa", { tools: ["phone_vibrate"] });
    const result = hub.callPhone("phone_vibrate", {});
    const outcome = expect(result).rejects.toThrow("did not answer in time");
    await vi.advanceTimersByTimeAsync(31_000);
    await outcome;
    expect(hub.describePhone().connected).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(hub.describePhone()).toEqual({ connected: false });
  });

  it("answers the newest phone when more than one has connected", async () => {
    vi.useFakeTimers();
    const hub = await freshHub();
    hub.hello("phone-aaaaaaaa", { tools: ["phone_vibrate"], label: "Old" });
    await vi.advanceTimersByTimeAsync(1_000);
    hub.hello("phone-bbbbbbbb", { tools: ["phone_vibrate"], label: "New" });
    expect(hub.describePhone()).toMatchObject({ connected: true, label: "New" });
    const result = hub.callPhone("phone_vibrate", {});
    const [call] = await hub.poll("phone-bbbbbbbb", never);
    expect(call?.tool).toBe("phone_vibrate");
    hub.settle("phone-bbbbbbbb", { id: call?.id, ok: true });
    await expect(result).resolves.toBeNull();
  });
});
