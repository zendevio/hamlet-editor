import { checkProductionBuild } from './i18n-build-guard-lib.mjs';

console.log(`Production i18n guard passed (${await checkProductionBuild(new URL('../build/', import.meta.url))} files).`);
