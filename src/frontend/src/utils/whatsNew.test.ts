import { describe, expect, it } from "vitest";
import { shouldShowWhatsNew } from "./whatsNew";

const base = {
  pathname: "/",
  latestVersion: "v1.6",
  localDismissedVersion: null,
  user: { onboarding_completed: true, whats_new_dismissed_version: null },
};

describe("shouldShowWhatsNew", () => {
  it("shows on the home page when neither the user nor the device dismissed it", () => {
    expect(shouldShowWhatsNew(base)).toBe(true);
  });

  it("never schedules the modal while /auth/me is still loading", () => {
    expect(shouldShowWhatsNew({ ...base, user: undefined })).toBe(false);
  });

  it("waits for onboarding to finish", () => {
    expect(
      shouldShowWhatsNew({ ...base, user: { ...base.user, onboarding_completed: false } }),
    ).toBe(false);
  });

  it("respects the dismissal recorded on another device", () => {
    expect(
      shouldShowWhatsNew({
        ...base,
        user: { ...base.user, whats_new_dismissed_version: "v1.6" },
      }),
    ).toBe(false);
  });

  it("respects a dismissal already stored on this device", () => {
    expect(shouldShowWhatsNew({ ...base, localDismissedVersion: "v1.6" })).toBe(false);
  });

  it("ignores a dismissal for an older release", () => {
    expect(
      shouldShowWhatsNew({
        ...base,
        localDismissedVersion: "v1.5",
        user: { ...base.user, whats_new_dismissed_version: "v1.5" },
      }),
    ).toBe(true);
  });

  it("does not open outside the home page", () => {
    expect(shouldShowWhatsNew({ ...base, pathname: "/expenses" })).toBe(false);
  });
});
