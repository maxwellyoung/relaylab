"""Assemble a labelled draft from actual browser captures and synthetic narration."""
import json
import subprocess
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'outputs/demo-2026-09-10'
SCENES = [
 ('01-healthy', 'This is a draft screenshot walkthrough of the real local RelayLab application, with synthetic narration. It is not a continuous screen recording. In the healthy case, the browser calls the coordinator, which sends JSON RPC to a separate downstream process. HTTP status 200 and a matching RPC result indicate success. The response evidence includes the correlation identifier and invented order data.'),
 ('02-rpc-error', 'Here the downstream service returns an application error. HTTP is still 200 because the reply arrived successfully. The RPC error code is minus thirty two thousand and one. This distinction matters: successful delivery does not mean the requested operation succeeded. The coordinator records the failed attempt without crashing.'),
 ('03-timeout', 'The slow dependency exceeds the coordinator deadline of four hundred milliseconds. This run took about four hundred and two milliseconds before the coordinator stopped waiting. The attempt is preserved with a timeout outcome. A timeout tells us that a response did not arrive in time. It does not prove the remote operation never ran.'),
 ('04-invalid', 'Malformed JSON is rejected before a new request is sent. The saved experiment count remains three. The local verification suite also checks restart persistence, database errors and the response contract. All thirty four tests passed on September tenth. This walkthrough uses SQLite. Lecturer MySQL, startup footage and GitHub website history still need final demonstration evidence.')]

def run(args): subprocess.run(args,check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)

def main():
    for name, narration in SCENES:
        (OUT / (name+'.txt')).write_text(narration+'\n')
        run(['say','-r','165','-f',str(OUT/(name+'.txt')),'-o',str(OUT/(name+'.aiff'))])
        run(['ffmpeg','-y','-loop','1','-i',str(OUT/(name+'.png')),'-i',str(OUT/(name+'.aiff')),'-vf','crop=460:510:90:0,scale=920:1020,pad=1280:1020:180:0:white','-c:v','libx264','-tune','stillimage','-r','20','-pix_fmt','yuv420p','-c:a','aac','-shortest',str(OUT/(name+'.mp4'))])
    (OUT/'concat.txt').write_text(''.join("file '"+n+".mp4'\n" for n,_ in SCENES))
    run(['ffmpeg','-y','-f','concat','-safe','0','-i',str(OUT/'concat.txt'),'-c','copy',str(OUT/'RelayLab-DRAFT-screenshot-walkthrough.mp4')])
    (OUT/'README.md').write_text('# Draft screenshot walkthrough\n\nActual browser screenshots captured on 10 September 2026 from the built local application, using invented data and SQLite. Narration is synthesized by macOS say. This is an edited sequence of still captures, not continuous screen recording or Maxwell speaking. It is preparation material. Final startup footage, GitHub website timestamps and lecturer MySQL evidence are not included.\n')
    print(OUT/'RelayLab-DRAFT-screenshot-walkthrough.mp4')

if __name__=='__main__':main()
