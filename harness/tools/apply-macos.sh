#!/bin/sh
# macOS용 DeepSeek Harness.app 에 overlay 적용 (원본 백업 → 패치 → asar 무결성 해시 갱신 → 업데이트 끔 → ad-hoc 재서명)
# 사용: sh apply-macos.sh ["/Applications/DeepSeek Harness.app"]
#   (먼저 이 폴더에서 `npm install` 로 @electron/asar 를 설치)
# 되돌리기: Resources/app.asar.orig 를 app.asar 로, Info.plist.orig 를 Info.plist 로 되돌린 뒤 같은 codesign 명령 실행
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
APP=${1:-"/Applications/DeepSeek Harness.app"}
RES="$APP/Contents/Resources"
PLIST="$APP/Contents/Info.plist"

[ -f "$RES/app.asar" ] || { echo "app.asar 없음: $RES" >&2; exit 1; }
if pgrep -f "$APP/Contents/MacOS/" >/dev/null; then echo "Harness가 켜져 있음. 종료 후 다시 실행" >&2; exit 1; fi

# 원본은 처음 한 번만 백업하고, 다시 실행해도 항상 원본에서 새로 만든다
[ -f "$RES/app.asar.orig" ] || cp "$RES/app.asar" "$RES/app.asar.orig"
[ -f "$PLIST.orig" ] || cp "$PLIST" "$PLIST.orig"

node "$HERE/apply-overlay.cjs" "$RES/app.asar.orig" "$RES/app.asar"

# Electron은 Info.plist 의 ElectronAsarIntegrity 해시(asar 헤더 JSON의 SHA256)가 틀리면 실행을 거부한다
HASH=$(cd "$HERE" && node -e 'const a=require("@electron/asar");process.stdout.write(require("crypto").createHash("sha256").update(a.getRawHeader(process.argv[1]).headerString).digest("hex"))' "$RES/app.asar")
/usr/libexec/PlistBuddy -c "Set :ElectronAsarIntegrity:Resources/app.asar:hash $HASH" "$PLIST"

cp "$HERE/app-update.yml" "$RES/app-update.yml"

# 파일을 바꿔 원래 서명이 깨지므로 ad-hoc 서명으로 다시 묶는다
codesign --force --deep -s - "$APP"
codesign -v "$APP"
echo "완료: $APP"
