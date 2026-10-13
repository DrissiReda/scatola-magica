import { mkdtempSync } from "fs";
import os from "os";
import path from "path";

const root = mkdtempSync(path.join(os.tmpdir(), "scatola-test-"));
process.env.UPLOAD_DIR = path.join(root, "uploads");
process.env.CONFIG_DIR = path.join(root, "config");
