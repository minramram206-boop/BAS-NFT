#!/usr/bin/env python3
"""Draw the back view of the ten active citizens' map sprites.

Each back sprite starts from the front sprite and is edited by hand-placed regions: the face,
the nose and anything the citizen holds are taken away, the silhouette is closed where they were,
and a few details (jacket seam, cap strap, hood seam) show that we are looking at the back.

This is placeholder art made in code, like the rest of the mock city (D-0024). Artist-made back
sprites replace it through `scripts/import_back_sprites.py`, which writes the same file names.

Writes `apps/web/public/sprites/citizens/<id>-back.png` and adds `"spriteBack"` to each citizen
in `content/en/citizens.json`. Output is deterministic.

Usage: python scripts/mock-city/generate_back_sprites.py
Needs Pillow, NumPy and SciPy.
"""

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "apps/web/public/sprites/citizens"
sys.path.insert(0, str(ROOT / "scripts"))
from import_back_sprites import CONTENT, add_field  # noqa: E402

OUTLINE=(20,16,20)

class Sprite:
    def __init__(self, n):
        self.n=n; self.im=np.array(Image.open(SRC / f"{n}.png").convert("RGBA")).astype(np.uint8)
        self.touched=np.zeros(self.im.shape[:2],bool)   # pixels whose silhouette changed
    @property
    def alpha(self): return self.im[...,3]>128
    def mask_poly(self,pts):
        m=Image.new("L",(128,128),0); ImageDraw.Draw(m).polygon([tuple(p) for p in pts],fill=255); return np.array(m)>0
    def mask_box(self,x0,y0,x1,y1):
        m=np.zeros((128,128),bool); m[y0:y1,x0:x1]=True; return m
    def mask_ellipse(self,cx,cy,rx,ry):
        yy,xx=np.mgrid[0:128,0:128]; return ((xx+.5-cx)/rx)**2+((yy+.5-cy)/ry)**2<=1
    def erase(self,m):
        self.im[m]=(0,0,0,0); self.touched|=m
    def paint(self,m,color,only_inner=0):
        if only_inner:
            m=m&ndi.binary_erosion(ndi.binary_fill_holes(self.alpha),iterations=only_inner)
        self.im[m]=(*color,255)
    def fill_opaque(self,m,color):
        self.im[m&self.alpha]=(*[*color],255)
    def add(self,m,color):
        self.im[m]=(*color,255); self.touched|=m
    def reoutline(self,width=3,color=OUTLINE,near=5):
        """Dark ring just inside every silhouette edge that was created by an edit."""
        a=self.alpha
        edge=a&~ndi.binary_erosion(a,iterations=width)
        local=ndi.binary_dilation(self.touched,iterations=near)
        self.im[edge&local]=(*color,255)
    def reshape(self, region, ellipse, fill, width=3, shade=None):
        """Inside `region`, make the silhouette follow the ellipse: cut outside, fill and outline inside."""
        cx,cy,rx,ry=ellipse
        outer=self.mask_ellipse(cx,cy,rx,ry); inner=self.mask_ellipse(cx,cy,rx-width,ry-width)
        self.erase(region&~outer)
        self.add(region&inner,fill)
        if shade is not None:
            band=inner&~self.mask_ellipse(cx-4,cy-3,rx-width-3,ry-width-3)
            self.add(region&band&(self.mask_box(0,int(cy),128,128)),shade)
        self.add(region&outer&~inner,OUTLINE)
    def reshape_poly(self, region, pts, fill, width=3, shade=None, shade_box=None):
        """Inside `region`, the silhouette follows the polygon: cut outside it, fill and outline inside."""
        outer=self.mask_poly(pts); inner=ndi.binary_erosion(outer,iterations=width)
        self.erase(region&~outer)
        self.add(region&inner,fill)
        if shade is not None and shade_box is not None:
            band=inner&~ndi.binary_erosion(outer,iterations=width+4)&shade_box
            self.add(region&band,shade)
        self.add(region&outer&~inner,OUTLINE)
    def save(self,path):
        Image.fromarray(self.im,"RGBA").save(path)


def line(s, pts, color, width=2):
    m=Image.new("L",(128,128),0); ImageDraw.Draw(m).line([tuple(p) for p in pts],fill=255,width=width)
    s.add(np.array(m)>0,color)

def not_color(s, region, family):
    """Pixels inside region whose colour is outside the family test."""
    r,g,b=(s.im[...,i].astype(int) for i in range(3))
    return region & s.alpha & ~family(r,g,b)

yellow=lambda r,g,b:(r>200)&(g>150)&(b<130)

def r1(s):
    HEAD=(254,246,218)
    s.erase(s.mask_box(104,62,128,102))                    # beer
    s.erase(s.mask_box(76,100,128,128))                    # wheat
    s.reshape_poly(s.mask_box(70,44,104,68),[(60,40),(94,40),(94,52),(91,62),(89,68),(60,68)],HEAD)
    s.paint(s.mask_box(46,20,96,64),HEAD,only_inner=4)     # glasses, eyes
    s.paint(s.mask_box(48,58,90,74),HEAD,only_inner=4)     # jaw line
    s.reoutline()

def r13(s):
    CREAM=(253,252,234); SHADE=(228,222,196)
    s.reshape_poly(s.mask_box(76,44,128,116),[(60,40),(101,40),(104,56),(106,74),(104,92),(97,106),(88,115),(60,115)],CREAM,shade=SHADE,shade_box=s.mask_box(80,80,128,120))
    s.paint(s.mask_box(36,12,106,52),CREAM,only_inner=4)
    s.paint(s.mask_box(50,64,106,76),CREAM,only_inner=4)

def r3(s):
    HEAD=(254,230,167); HOOD=(253,214,52)
    glass=not_color(s,s.mask_box(48,82,84,119),yellow)|not_color(s,s.mask_box(18,98,68,119),yellow)
    s.paint(glass,HOOD)
    s.erase(s.mask_box(18,121,90,128))
    s.add(s.mask_box(18,118,90,121)&s.alpha,OUTLINE)       # hem
    s.reshape_poly(s.mask_box(82,28,104,58),[(70,24),(94,24),(94,34),(92,46),(86,56),(70,58)],HEAD)
    s.paint(s.mask_box(44,10,96,60),HEAD,only_inner=4)
    line(s,[(40,62),(52,74),(70,80),(88,74),(98,62)],(210,160,20),2)   # hood seam across the back

def r12(s):
    CREAM=(254,252,235)
    s.reshape_poly(s.mask_box(98,44,128,80),[(80,42),(104,42),(105,56),(104,68),(99,78),(80,80)],CREAM)
    s.paint(s.mask_box(32,12,108,50),CREAM,only_inner=4)
    s.paint(s.mask_box(50,52,108,70),CREAM,only_inner=4)
    s.paint(s.mask_box(44,42,104,62),CREAM,only_inner=3)
    s.erase(s.mask_box(106,76,128,96))

def r19(s):
    HEAD=(254,243,200); BLUE=(74,128,178)
    s.reshape_poly(s.mask_box(98,46,128,78),[(80,44),(108,44),(109,56),(105,68),(99,78),(80,80)],HEAD)
    s.paint(s.mask_box(40,12,112,76),HEAD,only_inner=4)
    chest=s.mask_box(62,76,101,124)&s.alpha
    cream=lambda r,g,b:(r>200)&(g>190)&(b>120)&(b<235)
    flat=chest&cream(*(s.im[...,i].astype(int) for i in range(3)))
    src=np.zeros_like(s.im); ys,xs=np.where(flat)
    for y,x in zip(ys,xs):
        sx=123-x
        if 0<=sx<128 and s.im[y,sx,3]>0: src[y,x]=s.im[y,sx]
    ok=(src[...,3]>0)
    s.im[ok]=src[ok]
    cream_left=lambda r,g,b:(r>200)&(g>190)&(b>120)&(b<235)
    s.paint(s.mask_box(62,76,101,124)&s.alpha&cream_left(*(s.im[...,i].astype(int) for i in range(3))),(74,128,178))
    pink=lambda r,g,b:(r>190)&(g<150)&(b<150)
    pm=s.mask_box(56,56,96,92)&s.alpha&pink(*(s.im[...,i].astype(int) for i in range(3)))
    s.paint(pm&s.mask_box(0,0,128,77),HEAD)
    s.paint(pm&s.mask_box(0,77,128,128),(74,128,178))
    line(s,[(80,78),(80,120)],(20,16,20),2)

def r4(s):
    HEAD=(253,236,200); COAT=(253,214,52)
    s.reshape_poly(s.mask_box(88,28,116,56),[(80,24),(100,24),(101,38),(98,48),(92,56),(80,58)],HEAD)
    s.paint(s.mask_box(52,8,102,58),HEAD,only_inner=4)
    s.paint(s.mask_box(72,68,86,100),COAT,only_inner=3)    # buttons
    s.paint(not_color(s,s.mask_box(28,84,44,100),yellow),COAT)

def r2(s):
    HEAD=(254,250,237)
    s.reshape_poly(s.mask_box(60,30,128,128),[(40,28),(86,28),(87,50),(85,76),(80,98),(72,114),(60,121),(40,121)],HEAD)
    s.paint(s.mask_box(30,12,92,50),HEAD,only_inner=4)
    s.paint(s.mask_box(30,54,64,72),HEAD,only_inner=4)
    s.paint(s.mask_box(48,46,62,56),HEAD,only_inner=3)
    line(s,[(6,56),(30,60),(60,60),(84,54)],(40,52,64),3)   # mask strap

def r8(s):
    BODY=(253,234,200)
    brown=lambda r,g,b:(r>90)&(r<200)&(g<150)&(b<100)
    s.reshape_poly(s.mask_box(52,0,128,128),[(52,22),(62,24),(68,32),(72,44),(74,52),(75,62),(78,70),(84,82),(88,96),(90,110),(86,120),(78,127),(52,127)],BODY)
    s.paint(s.mask_box(9,96,44,124),BODY,only_inner=3)
    s.paint(s.mask_box(3,82,30,100)&brown(*(s.im[...,i].astype(int) for i in range(3))),BODY)
    s.paint(s.mask_box(28,28,76,68),BODY,only_inner=4)
    s.paint(s.mask_box(30,62,76,82),BODY,only_inner=4)
    s.paint(s.mask_box(44,72,80,114),BODY,only_inner=3)

def r11(s):
    HEAD=(254,248,230); JACKET=(58,60,66)
    s.reshape_poly(s.mask_box(100,44,128,78),[(80,42),(108,42),(109,54),(106,66),(100,78),(80,80)],HEAD)
    s.paint(s.mask_box(44,12,112,52),HEAD,only_inner=4)
    s.paint(s.mask_box(60,58,118,76),HEAD,only_inner=4)
    s.paint(s.mask_box(40,44,112,62),HEAD,only_inner=3)
    cream=lambda r,g,b:(r>230)&(g>225)&(b>200)
    s.paint(s.mask_box(60,76,102,126)&s.alpha&cream(*(s.im[...,i].astype(int) for i in range(3))),JACKET)
    s.paint(s.mask_box(20,104,42,124)&s.alpha&cream(*(s.im[...,i].astype(int) for i in range(3))),JACKET)
    line(s,[(82,78),(82,124)],(20,16,20),2)

def r18(s):
    BODY=(253,238,196); CAP=(112,72,48)
    s.reshape_poly(s.mask_box(100,54,128,84),[(80,52),(104,52),(105,64),(104,76),(100,84),(80,86)],BODY)
    s.reshape_poly(s.mask_box(90,26,128,60),[(70,24),(98,24),(101,36),(101,50),(98,60),(70,60)],CAP)
    s.paint(s.mask_box(34,28,100,58),CAP,only_inner=4)      # goggles and face become the back of the cap
    s.paint(s.mask_box(54,62,100,82),BODY,only_inner=3)
    s.paint(s.mask_box(44,76,56,90),BODY,only_inner=4)
    line(s,[(24,45),(60,48),(104,45)],(30,24,28),3)        # goggle strap

RECIPES = {1: r1, 13: r13, 3: r3, 12: r12, 19: r19, 4: r4, 2: r2, 8: r8, 11: r11, 18: r18}


def main() -> int:
    for citizen, recipe in RECIPES.items():
        sprite = Sprite(citizen)
        recipe(sprite)
        sprite.save(SRC / f"{citizen}-back.png")
        if not any(add_field(file, citizen) for file in CONTENT):
            raise SystemExit(f"citizen {citizen} is not in the content files")
        print(f"ok  {citizen}-back.png")
    return 0


if __name__ == "__main__":
    sys.exit(main())
