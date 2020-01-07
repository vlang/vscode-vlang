import { ExecException } from 'child_process';

type ExecVCallback = (error: ExecException, stdout: string, stderr: string) => void;
