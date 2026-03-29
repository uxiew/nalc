export interface NalcGlobal {
  nalcHomeDir: string;
}

/*
  Not using Node.Global because in this case
*/
export const nalcGlobal: NalcGlobal = global as any;

/**
 * Constant values
 */
export const VALUES = {
  /** Name of the package */
  myName: 'nalc',
  /** Version of the package */
  version: '__VERSION__',
  /** Default directory name used inside the user home folder */
  storeDirName: 'nalc',
  /** Name of the lockfile */
  lockfileName: 'nalc.lock',
  /** Name of the folder where nalc stores consumer state */
  nalcStateFolder: '.nalc',
  /** Name of the script to run before publish */
  prescript: 'prenalc',
  /** Name of the script to run after publish */
  postscript: 'postnalc',
  /** Name of the rc file */
  rcFile: '.nalcrc',
  /** Name of the installations file */
  installationsFile: 'consumers.json',
  /** Name of the signature file */
  signatureFile: 'nalc.sig',
};

export const VALID_FLAGS = [
  'port',
  'workspace-resolve',
  'dev-mod',
  'scripts',
  'quiet',
  'mode',
  'ignore',
  'dir',
];
