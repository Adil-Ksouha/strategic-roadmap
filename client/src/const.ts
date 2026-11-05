export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

/** Returns the browser to the private platform sign-in screen. */
export const startLogin = () => window.location.assign("/");
