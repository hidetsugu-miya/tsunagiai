# Keeps the top H rows of a non-interlaced 8-bit PNG shot of a window W px wide (the filter bytes stay valid when only the bottom rows go).
# H and W are in window px. A capture at 2x (Retina) is twice as wide, so it keeps 2 * H rows.
import struct, sys, zlib
src, dst, H, W = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
d = open(src,'rb').read(); pos = 8; idat=b''; ihdr=None
while pos < len(d):
    n, t = struct.unpack('>I4s', d[pos:pos+8]); c = d[pos+8:pos+8+n]; pos += 12+n
    if t==b'IHDR': ihdr=c
    elif t==b'IDAT': idat+=c
w,h,bd,ct,cm,fm,il = struct.unpack('>IIBBBBB', ihdr)
assert il==0 and bd==8 and w % W == 0, f"{w}x{h}, bit depth {bd}, interlace {il}: not a whole multiple of {W} px wide"
H *= w // W
assert H <= h, f"{H} rows wanted, {h} in the capture"
ch={0:1,2:3,3:1,4:2,6:4}[ct]; stride=w*ch+1
raw=zlib.decompress(idat)[:stride*H]
def chunk(t,c): return struct.pack('>I',len(c))+t+c+struct.pack('>I',zlib.crc32(t+c))
out=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',w,H,bd,ct,cm,fm,il))+chunk(b'IDAT',zlib.compress(raw,9))+chunk(b'IEND',b'')
open(dst,'wb').write(out)
