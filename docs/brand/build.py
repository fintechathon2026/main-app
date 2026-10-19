"""Reins logo kit builder: centerline geometry -> filled outlines (nonzero union, all CCW)."""
import math
INK, LIME, PAPER = "#16161B", "#EBFE06", "#F5F5F2"
f = lambda v: f"{round(v,2):g}"
pt = lambda x,y: f"{f(x)},{f(y)}"

def capsule(p0, p1, h):
    (x0,y0),(x1,y1) = p0,p1
    L = math.hypot(x1-x0, y1-y0); nx, ny = -(y1-y0)/L*h, (x1-x0)/L*h
    return (f"M{pt(x0+nx,y0+ny)} L{pt(x1+nx,y1+ny)} A{f(h)} {f(h)} 0 0 0 {pt(x1-nx,y1-ny)} "
            f"L{pt(x0-nx,y0-ny)} A{f(h)} {f(h)} 0 0 0 {pt(x0+nx,y0+ny)} Z")

def dot(c, r):
    x,y = c
    return f"M{pt(x+r,y)} A{f(r)} {f(r)} 0 1 0 {pt(x-r,y)} A{f(r)} {f(r)} 0 1 0 {pt(x+r,y)} Z"

def sector(c, R, t0, t1, h):
    """Stroked arc, centre c, radius R, screen angles t0->t1 (deg, t1>t0), half-width h, round caps."""
    cx,cy = c; a0,a1 = math.radians(t0), math.radians(t1)
    P = lambda r,a: (cx+r*math.cos(a), cy+r*math.sin(a))
    big = 1 if (t1-t0) > 180 else 0
    Ro, Ri = R+h, R-h
    d = (f"M{pt(*P(Ro,a1))} A{f(Ro)} {f(Ro)} 0 {big} 0 {pt(*P(Ro,a0))} "
         f"L{pt(*P(Ri,a0))} A{f(Ri)} {f(Ri)} 0 {big} 1 {pt(*P(Ri,a1))} Z")
    return " ".join([d, dot(P(R,a0),h), dot(P(R,a1),h)])

# ---------- symbol: Taut R ----------
def R_mark(h=16, small=False):
    if small:  # heavier cut for 16-32 px
        h = 20; sx, top, cx, Rb, mid, foot_y, foot_x = 60, 40, 116, 48, 136, 200, 196
    else:
        sx, top, cx, Rb, mid, foot_y, foot_x = 56, 40, 120, 48, 136, 200, 200
    leg0 = (cx-16, mid)
    leg1 = (leg0[0] + (foot_y-mid)/math.tan(math.radians(60)), foot_y)   # exact 60 degrees
    parts = [capsule((sx,top),(sx,foot_y+16), h),
             capsule((sx,top),(cx,top),h),
             capsule((sx,mid),(cx,mid),h),
             sector((cx,top+Rb), Rb, 270, 450, h),
             capsule(leg0, leg1, h), capsule(leg1, (foot_x, foot_y), h)]
    return " ".join(parts)

# ---------- wordmark: reins ----------
def wordmark(ox=0, h=8):
    x=22+ox; cx=130+ox; xi=206+ox; xn=242+ox; xs=336+ox
    parts = [capsule((x,176),(x,124),h), sector((x+28,124),28,180,270,h), capsule((x+28,96),(x+44,96),h),
             capsule((cx-40,136),(cx+40,136),h), sector((cx,136),40,45,360,h),
             capsule((xi,96),(xi,176),h), dot((xi,66),10),
             capsule((xn,96),(xn,176),h), sector((xn+32,128),32,180,360,h), capsule((xn+64,128),(xn+64,176),h),
             sector((xs+24,116),20,90,330,h), sector((xs+24,156),20,270,510,h)]
    return " ".join(parts)

def svg(w, hgt, body, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {hgt}" width="{w}" height="{hgt}" '
            f'role="img" aria-labelledby="t"><title id="t">{title}</title>{body}</svg>\n')
path = lambda d, c, id_: f'<path id="{id_}" fill="{c}" d="{d}"/>'

K = ""
sym = R_mark()
open(K+"reins-symbol.svg","w").write(svg(256,256,path(sym,INK,"symbol"),"Reins"))
open(K+"reins-symbol-small.svg","w").write(svg(256,256,path(R_mark(small=True),INK,"symbol"),"Reins"))
open(K+"reins-symbol-reversed.svg","w").write(svg(256,256,path(R_mark(h=15),LIME,"symbol"),"Reins"))
open(K+"reins-wordmark.svg","w").write(svg(420,256,path(wordmark(ox=8),INK,"wordmark"),"Reins"))

# horizontal lockup: R baseline (outer y 232) aligned with wordmark baseline (outer y 184)
s=0.625; ty=184-232*s; ox=200
def horiz(cs, cw, bg=None, sym_d=sym):
    b = f'<rect width="613" height="256" fill="{bg}"/>' if bg else ""
    return svg(613,256, b+f'<g transform="translate(0,{f(ty)}) scale({s})">{path(sym_d,cs,"symbol")}</g>'
                          + path(wordmark(ox=ox),cw,"wordmark"), "Reins")
open(K+"reins-horizontal.svg","w").write(horiz(INK,INK))
open(K+"reins-horizontal-reversed.svg","w").write(horiz(LIME,PAPER,sym_d=R_mark(h=15)))
open(K+"reins-horizontal-on-ink.svg","w").write(horiz(LIME,PAPER,bg=INK,sym_d=R_mark(h=15)))

# stacked lockup: symbol over wordmark, centred
def stacked(cs, cw):
    ss=0.75; wx=(420-8-394)/2  # wordmark ink spans ~x 14..402 at ox=0
    return svg(420,398, f'<g transform="translate({f(210-128*ss)},16) scale({ss})">{path(sym,cs,"symbol")}</g>'
                         + f'<g transform="translate(0,180)">{path(wordmark(ox=9),cw,"wordmark")}</g>', "Reins")
open(K+"reins-stacked.svg","w").write(stacked(INK,INK))
print("ok")

# favicon: tile so it survives light and dark browser chrome
fav = (f'<rect width="256" height="256" rx="56" fill="{INK}"/>'
       f'<g transform="translate(25.6,22.6) scale(0.8)">{path(R_mark(small=True),LIME,"symbol")}</g>')
open(K+"reins-favicon.svg","w").write(svg(256,256,fav,"Reins"))
