# Genera las propuestas de logo (SVG) y una página de vista previa.
import math, os, io
OUT = os.path.dirname(os.path.abspath(__file__))
W = '#F2F5F4'; TEAL = '#3CC4A8'; TEAL2 = '#1E8C78'

def bg(maskable):
    # Fondo oscuro con luces difuminadas (mismo lenguaje que la app). Maskable: a sangre, sin esquinas.
    rx = 0 if maskable else 116
    return f'''<defs>
  <linearGradient id="g0" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#171C1D"/><stop offset="1" stop-color="#0B0E0F"/></linearGradient>
  <radialGradient id="g1" cx="0.18" cy="0.12" r="0.75"><stop offset="0" stop-color="#2A9D8F" stop-opacity=".55"/><stop offset="1" stop-color="#2A9D8F" stop-opacity="0"/></radialGradient>
  <radialGradient id="g2" cx="0.92" cy="0.95" r="0.7"><stop offset="0" stop-color="#B57C42" stop-opacity=".45"/><stop offset="1" stop-color="#B57C42" stop-opacity="0"/></radialGradient>
  <linearGradient id="gt" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5FE0C3"/><stop offset="1" stop-color="{TEAL2}"/></linearGradient>
  <linearGradient id="gz" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#E5484D"/><stop offset=".45" stop-color="#F5A524"/><stop offset="1" stop-color="#3CC4A8"/></linearGradient>
  <clipPath id="cl"><rect width="512" height="512" rx="{rx}"/></clipPath>
</defs>
<g clip-path="url(#cl)">
  <rect width="512" height="512" fill="url(#g0)"/>
  <rect width="512" height="512" fill="url(#g1)"/>
  <rect width="512" height="512" fill="url(#g2)"/>
  {'' if maskable else f'<rect x="1.5" y="1.5" width="509" height="509" rx="{rx-1.5}" fill="none" stroke="#fff" stroke-opacity=".10" stroke-width="3"/>'}
</g>'''

def blades(cx, cy, r_in, r_out, n, sweep_deg, width, color, rot=0):
    s = ''
    for k in range(n):
        a0 = math.radians(rot + k * 360 / n)
        a1 = a0 + math.radians(sweep_deg)
        am = a0 + math.radians(sweep_deg * 0.25)
        p1 = (cx + r_in * math.cos(a0), cy + r_in * math.sin(a0))
        p2 = (cx + r_out * math.cos(a1), cy + r_out * math.sin(a1))
        c = (cx + (r_out * 0.78) * math.cos(am), cy + (r_out * 0.78) * math.sin(am))
        s += f'<path d="M{p1[0]:.1f} {p1[1]:.1f} Q{c[0]:.1f} {c[1]:.1f} {p2[0]:.1f} {p2[1]:.1f}" fill="none" stroke="{color}" stroke-width="{width}" stroke-linecap="round"/>'
    return s

def scale(content, s):
    # Encoge el dibujo hacia el centro (para el ícono «maskable», zona segura del 80 %)
    return f'<g transform="translate(256 256) scale({s}) translate(-256 -256)">{content}</g>'

# A · Bomba centrífuga: carcasa en espiral con salida + rodete verde
def mark_a():
    cx, cy, r = 248, 284, 138
    casing = (f'<path d="M{cx+r} 92 V{cy} A{r} {r} 0 1 1 {cx} {cy-r} H{cx+r-64} V92" fill="none" stroke="{W}" stroke-width="24" stroke-linejoin="round"/>'
              f'<path d="M{cx+r-84} 92 H{cx+r+20}" stroke="{W}" stroke-width="24" stroke-linecap="round"/>')
    imp = (f'<circle cx="{cx}" cy="{cy}" r="88" fill="#fff" fill-opacity=".05"/>'
           + blades(cx, cy, 26, 84, 6, 62, 15, 'url(#gt)', rot=-20)
           + f'<circle cx="{cx}" cy="{cy}" r="20" fill="{W}"/><circle cx="{cx}" cy="{cy}" r="8" fill="{TEAL2}"/>')
    return casing + imp

# B · Rodete dentro de un arco de eficiencia (rojo → ámbar → verde) con marca
def mark_b():
    cx, cy, R = 256, 270, 168
    a_s, a_e = 135, 405  # 270° de arco, abierto abajo
    def P(a, r): return (cx + r * math.cos(math.radians(a)), cy + r * math.sin(math.radians(a)))
    p0, p1 = P(a_s, R), P(a_e, R)
    arc = f'<path d="M{p0[0]:.1f} {p0[1]:.1f} A{R} {R} 0 1 1 {p1[0]:.1f} {p1[1]:.1f}" fill="none" stroke="url(#gz)" stroke-width="26" stroke-linecap="round"/>'
    m = P(345, R)
    mark = f'<circle cx="{m[0]:.1f}" cy="{m[1]:.1f}" r="22" fill="{W}"/><circle cx="{m[0]:.1f}" cy="{m[1]:.1f}" r="9" fill="{TEAL2}"/>'
    imp = (f'<circle cx="{cx}" cy="{cy}" r="112" fill="#fff" fill-opacity=".06" stroke="#fff" stroke-opacity=".14" stroke-width="3"/>'
           + blades(cx, cy, 30, 100, 7, 64, 16, W, rot=-10)
           + f'<circle cx="{cx}" cy="{cy}" r="24" fill="url(#gt)"/>')
    return arc + imp + mark

# C · Gota de agua con medidor adentro
def mark_c():
    drop = f'<path d="M256 70 C 256 70 392 214 392 316 A136 136 0 0 1 120 316 C120 214 256 70 256 70 Z" fill="url(#gt)"/>'
    shine = '<path d="M168 300 A92 92 0 0 1 196 228" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="12" stroke-linecap="round"/>'
    cx, cy, R = 256, 330, 82
    g = f'<path d="M{cx-R} {cy} A{R} {R} 0 0 1 {cx+R} {cy}" fill="none" stroke="#0B0E0F" stroke-opacity=".30" stroke-width="18" stroke-linecap="round"/>'
    g += f'<path d="M{cx-R} {cy} A{R} {R} 0 0 1 {cx+R*math.cos(math.radians(-40)):.1f} {cy+R*math.sin(math.radians(-40)):.1f}" fill="none" stroke="{W}" stroke-width="18" stroke-linecap="round"/>'
    nx, ny = cx + 64 * math.cos(math.radians(-40)), cy + 64 * math.sin(math.radians(-40))
    g += f'<line x1="{cx}" y1="{cy}" x2="{nx:.1f}" y2="{ny:.1f}" stroke="#0B0E0F" stroke-width="14" stroke-linecap="round"/><circle cx="{cx}" cy="{cy}" r="17" fill="#0B0E0F"/>'
    return drop + shine + g

def svg(mark, maskable=False):
    body = scale(mark, 0.78) if maskable else scale(mark, 0.92)
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">{bg(maskable)}{body}</svg>'

MARKS = {'A': mark_a, 'B': mark_b, 'C': mark_c}
for k, fn in MARKS.items():
    io.open(os.path.join(OUT, f'logo-{k}.svg'), 'w', encoding='utf-8').write(svg(fn()))
    io.open(os.path.join(OUT, f'logo-{k}-maskable.svg'), 'w', encoding='utf-8').write(svg(fn(), True))
print('ok')
