import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";

// A loaded machine can take longer than the 1 s default to settle React state.
configure({ asyncUtilTimeout: 5_000 });
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
