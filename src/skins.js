// CSS skins applied over the host's HTML binding output (inside a shadow root).
// They restyle the same markup; they are not separate bindings.
export const SKINS = {
  base: `
.k-body{padding:14px;margin:0;min-height:100%;position:relative;border-radius:inherit}
.k-body .k-page-title{display:none}
.ovl{position:absolute;inset:0;display:flex;align-items:flex-start;justify-content:center;padding:48px 12px;background:rgba(0,0,0,.35);border-radius:inherit}
.ovl .k-overlay{background:none;padding:0;width:100%;display:flex;justify-content:center}
.k-table{display:table}.k-block-body{overflow-x:auto}
@media (max-width:560px){.k-block-h{flex-direction:column;gap:6px}.k-table td,.k-table th{padding:6px 4px;font-size:12px}}
`,
  kumo: ``,
  mac7: `
.k-body{--bg:#fff;--card:#fff;--line:#000;--fg:#000;--mut:#444;--brand:#000;--good:#000;--bad:#000;background:#fff;font:12px/1.4 Chicago,Geneva,"Charcoal",ui-monospace,monospace}
.k-block{border:2px solid #000;border-radius:0;box-shadow:2px 2px 0 #000}
.k-block-h{background:repeating-linear-gradient(#fff 0 1px,#000 1px 2px);border-bottom:2px solid #000}
.k-block-h h3{background:#fff;padding:0 8px;display:inline-block}
.k-btn{border:2px solid #000;border-radius:8px;background:#fff;color:#000}
.btn-primary{background:#fff;color:#000;box-shadow:0 0 0 2px #fff,0 0 0 4px #000}
.k-badge{border:1px solid #000;border-radius:0;background:#fff !important;color:#000 !important}
.k-table th{color:#000;border-bottom:2px solid #000}.k-table tr.clickable:hover{background:#000;color:#fff}
.k-dialog{border:2px solid #000;border-radius:0;box-shadow:4px 4px 0 #000}
.ovl{background:repeating-conic-gradient(#000 0 25%,#fff 0 50%) 0 0/2px 2px;opacity:1}
`,
  swiss: `
.k-body{--bg:#f4f1ea;--card:#f4f1ea;--line:#111;--fg:#111;--mut:#555;--brand:#e30613;background:#f4f1ea;font:14px/1.35 "Helvetica Neue",Helvetica,Arial,sans-serif}
.k-block{border:0;border-top:3px solid #111;border-radius:0;background:none}
.k-block-h{border-bottom:1px solid #111;padding-left:0;padding-right:0}.k-block-body{padding-left:0;padding-right:0}
.k-block-h h3{font-size:22px;font-weight:700;letter-spacing:-.02em}
.k-stat-value{font-size:44px;font-weight:700;letter-spacing:-.04em}.k-stat-label{text-transform:uppercase;letter-spacing:.08em;color:#111}
.k-badge{border-radius:0;background:none !important;border:1px solid currentColor}
.b-error{color:#e30613 !important}.b-success{color:#111 !important}
.k-table th{color:#111;text-transform:uppercase;letter-spacing:.06em;font-size:11px;border-bottom:2px solid #111}
.k-btn{border-radius:0;border:1px solid #111}.btn-primary{background:#e30613;border-color:#e30613}
.k-dialog{border-radius:0;border:0;border-top:6px solid #e30613}
`,
  lcars: `
.k-body{--bg:#000;--card:#000;--line:#9977aa;--fg:#ff9966;--mut:#cc99cc;--brand:#ff9900;--good:#99ccff;--bad:#ff5555;background:#000;color:#ff9966;font:600 14px/1.35 "Antonio","Arial Narrow",sans-serif;text-transform:uppercase;letter-spacing:.04em}
.k-block{border:0;border-left:18px solid #cc99cc;border-radius:24px 0 0 24px;background:#000}
.k-block-h{border-bottom:4px solid #ff9900;border-radius:0}.k-block-h h3{color:#ffcc66}
.k-stat-value{color:#99ccff;font-size:30px}.k-stat-label{color:#cc99cc}
.k-badge{border-radius:10px;background:#9977aa !important;color:#000 !important}.b-error{background:#ff5555 !important}.b-success{background:#99ccff !important}
.k-table th{color:#ff9900;border-bottom:2px solid #9977aa}.k-table td{border-bottom:1px solid #332244}
.k-table tr.clickable:hover{background:#221133}
.k-btn{border:0;border-radius:14px;background:#ff9900;color:#000;text-transform:uppercase}
.k-dialog{background:#000;border:0;border-left:14px solid #ff9900;border-radius:20px 0 0 20px;color:#ff9966}
.k-dialog footer{border-top:3px solid #cc99cc}.k-check{color:#cc99cc}
`,
  shadcn: `
.k-body{--bg:#fff;--card:#fff;--line:#e4e4e7;--fg:#09090b;--mut:#71717a;--brand:#18181b;background:#fff;font:14px/1.5 Inter,ui-sans-serif,system-ui,sans-serif}
.k-block{border-radius:12px;box-shadow:0 1px 2px rgba(0,0,0,.05)}
.k-btn{border-radius:6px;font-weight:500}.btn-primary{background:#18181b;border-color:#18181b}
.k-badge{border-radius:6px;font-weight:500}.b-success{background:#f4f4f5;color:#18181b}.b-error{background:#ef4444;color:#fff}
.k-table th{font-weight:500}.k-dialog{border-radius:10px;box-shadow:0 10px 40px rgba(0,0,0,.18)}
`
};
