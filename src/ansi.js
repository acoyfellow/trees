// Colorizes plain-text output from the IAP terminal binding using ANSI SGR escapes
// for display inside cloudterm. The underlying IAP terminal renderer stays plain text.
const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const AMBER = "\x1b[38;5;214m";
const BORDER = "\x1b[38;5;71m";

export function colorizePage(text) {
  return text
    .split("\n")
    .map((line, idx) => {
      if (idx === 0) return `${BOLD}${AMBER}${line}${RESET}`;
      if (idx === 1 && /^═+$/.test(line.trim())) return `${DIM}${AMBER}${line}${RESET}`;
      let out = line;
      // Box borders
      if (/^[┌└├│╔╚╟║]/.test(out)) {
        out = out.replace(/^([┌└├│])(─ )([^─]+)( ─+)/, `${BORDER}$1$2${BOLD}${CYAN}$3${RESET}${BORDER}$4${RESET}`);
      }
      // Status badges
      out = out.replace(/\(✓ passing\)/g, `${GREEN}(✓ passing)${RESET}`);
      out = out.replace(/\(! failing\)/g, `${RED}(! failing)${RESET}`);
      out = out.replace(/\(Lead\)/g, `${CYAN}(Lead)${RESET}`);
      // Row selectors like "1›"
      out = out.replace(/(\b[1-9])›/g, `${BOLD}${CYAN}$1›${RESET}`);
      // Checkbox
      out = out.replace(/\[x\]/g, `${GREEN}[x]${RESET}`).replace(/\[ \]/g, `${DIM}[ ]${RESET}`);
      // Buttons
      out = out.replace(/\[\[([^\]]+)\]\]/g, `${BOLD}${AMBER}[[$1]]${RESET}`);
      // Footer hint
      out = out.replace(/(row ↵: .*)$/, `${DIM}${YELLOW}$1${RESET}`);
      return out;
    })
    .join("\r\n");
}

export function colorizeOverlay(text) {
  return text
    .split("\n")
    .map((line) => {
      let out = line;
      if (/^╔═ /.test(out)) {
        out = out.replace(/^(╔═ )([^═]+)( ═+╗)$/, `${AMBER}$1${BOLD}\x1b[97m$2${RESET}${AMBER}$3${RESET}`);
      } else if (/^[╟╚]/.test(out)) {
        out = `${AMBER}${out}${RESET}`;
      } else if (/^║/.test(out)) {
        out = out
          .replace(/^║/, `${AMBER}║${RESET}`)
          .replace(/║$/, `${AMBER}║${RESET}`)
          .replace(/\[\[([^\]]+)\]\]/g, `${BOLD}${AMBER}[[$1]]${RESET}`)
          .replace(/\[ Close \]/g, `${CYAN}[ Close ]${RESET}`);
      } else if (/^· /.test(out)) {
        out = `${DIM}${YELLOW}${out}${RESET}`;
      }
      return out;
    })
    .join("\r\n");
}
