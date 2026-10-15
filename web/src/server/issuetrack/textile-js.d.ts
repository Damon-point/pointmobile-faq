declare module "textile-js" {
  /** Textile 마크업 → HTML 문자열. */
  function textile(src: string, options?: { breaks?: boolean }): string;
  export default textile;
}
