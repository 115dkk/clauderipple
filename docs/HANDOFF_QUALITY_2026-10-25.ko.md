# 솔 전환 인계 — ClaudeRipple·Ripple Remote 품질 개선

확인: 2026-10-25 16:32 KST 조회 후, 스크롤 시뮬레이터 완료 알림까지 반영. 사용자 요청으로 메인을 Astra에서 Sol로 바꾸기 직전 작성. 실제 모델 전환은 사용자가 한다.

### 최신 변경 — 시뮬레이터 결과 도착

- 현재 계속 실행 중인 워커는 설치 소유권 `a9fa1c09b3055502b`, 웹 발신함 `a421f429d49a791f2` **2개**다. 스크롤 워커 `a45e8cce4d09db70a`는 조건 불충족 보고 후 대기.
- 앱·공유 web 타입검사와 포커스32개 통과, **Release simulator 빌드 성공**(16:26:13→16:29:28).
- **스크롤 바 시각검증은 실패가 아니라 미실시**: 무서명 `CODE_SIGNING_ALLOWED=NO` 빌드는 ExpoSecureStore에서 `A required entitlement is not present`(-34018)를 내며 시작 복구화면에 남음. 새 UI 버그로 간주해 소스를 우회 수정하지 않는다.
- 두 번째 차단: simctl openurl 확인창을 누를 tap/swipe 도구가 이 워커에 없음. idb/cliclick/applesimutils 없음. main의 사용 가능한 시뮬레이터/컴퓨터 조작 도구는 스킬·ToolSearch로 먼저 확인할 수 있음. 도구가 없다고 추측하지 않되 실제 가능성이 확인되기 전 성공 주장 금지.
- 증거 및 빌드: `/tmp/ripple-scroll-verify/20261025-162613/` (`build.log`, `udid.txt`, `keychain-log.txt`, `01-launch.png`~`05-startup-error-clean.png`, `DerivedData/`). DerivedData 약 **6.0GB**, 증분 재사용 가능. 아직 삭제 안 함.
- 생성한 sim: `51133B45-F51B-44A5-8151-F939C2A551DF`, 이름 `ripple-scroll-verify`, 현재 **shutdown 상태로 유지**. 기존 sim과 실기기는 미접촉.
- 다음 제안은 아직 승인/실행되지 않음: 같은 DerivedData에서 계정 불필요한 **ad-hoc 서명**(`CODE_SIGN_IDENTITY="-"`, signing allowed, team/profile 빈값)으로 entitlement 포함 재빌드 + 승인된 UI 조작 도구. 실제 계정/서명키 접근·의존성 설치를 임의로 하지 않는다.
- 바로 할 일은 빌드를 처음부터 반복하는 것이 아니라 **조작 도구와 ad-hoc entitlement 경계 확인 후 제한된 재검증 계획 결정**이다.

## 1. 가장 먼저 할 일

1. `docs/QUALITY_BACKLOG.ko.md`를 작업 원장으로 사용한다. 이미 조사한 내용을 처음부터 다시 조사하거나 기존 테스트 전체를 반복하지 않는다.
2. 아래 3개 DeepSeek 중 설치·웹 2개는 실행 중이고 스크롤은 최신 결과를 받고 대기 중이다. 완료 알림을 받아 이어서 검수한다. 같은 범위를 새 워커에 중복 배정하지 않는다. 모델 전환으로 작업이 중단됐으면 완료로 가정하지 말고 상태/변경을 확인해 이어 맡긴다.
3. 설치 소유권·웹 발신함은 **검수 보완 중이며 커밋하지 않았다.** 특히 삭제·원문 유실 관련 부분은 전체 diff를 본다.
4. 모바일 스크롤 검증은 **Release 빌드 성공, 실제 관찰은 entitlement·조작 도구 문제로 미실시**다. 위 최신 결과를 먼저 읽는다. 떨림 해소를 주장하지 않는다.
5. 완료 보고 → 영향 범위 테스트/타입 검사 → 핵심 또는 안전 경계 전체 diff → 논리 단위 커밋. 운영 반영은 별도 승인이다.

## 2. 사용자의 현재 지시

- 호칭은 주군, 정중한 한국어.
- 목표는 유명 앱보다 높은 실제 완성도. 버그만 고치고 끝내거나 기능 목록만 늘리는 것이 아니다.
- 16시 제한은 사용자가 해제했다. 누락 없이 계속 개선한다.
- **현재 워커는 모두 DeepSeek. 새 구현·조사·테스트는 DeepSeek에 맡기고 메인은 지휘·판단·검수·커밋을 한다.** 새 Astra/Claude 워커를 시작하지 않는다. 솔로 전환한다는 말은 메인 모델 변경이지 워커 배정 변경이 아니다.
- `subagent_type: deepseek-v4-1-flash`, model 인자는 넣지 않는다. 프롬프트 첫 두 줄:
  - `[[ripple: deepseek-v4-1-flash]]`
  - `Model reason: user "지금돌아가는거끝나면 이제부턴 딥시크쓰자."`
- 메시지/지시문/대기열 **원문 요약·절단 전송 금지**. 표시용 200바이트 preview도 사용자가 거절했고 철회했다. 전송 크기는 원문 무손실 분할로 해결한다.
- 진행 보고는 첫 도구 전과 작업 방향/결과가 바뀔 때 짧게 한다. 완료 전 실제 검증한다.
- 새 공개 한국어 문구는 사용자에게 2차 검수 여부를 물어야 한다. Gemini 사용 지침과 DeepSeek만 사용 지시가 충돌할 수 있으므로 임의로 다른 모델을 호출하지 말고 사용자 결정을 받는다. 기존 문구 재사용으로 뜻을 바꾸는 꼼수도 금지.

## 3. 저장소와 현재 상태

### 본체

- 경로 `/Users/pbj/Documents/ClaudeRipple`
- 브랜치 `fix/remote-session-consistency`
- HEAD `a4632e0` (모드 장애 표시·컨텍스트 캐시).
- 최근 중요한 커밋:
  - `04d38cc`: 큰 HostMsg 무손실 chunk 전송
  - `f3be407`: 설정 갱신/모델 선택/컨텍스트 창 보존
  - `622ee7a`: 실행·대기 워커 보존, 종료 기록만 40개
  - `e867726`: 복귀 시 연결 probe, 3초 무응답 재접속
  - `d0d5b8d`: 타이머 누수·재진입 경합
  - 나머지는 품질 원장의 C01~C19 및 git log 참조.

### 모바일 (별도 비공개 git 저장소)

- 경로 `/Users/pbj/Documents/ClaudeRipple/apps/ripple-remote`
- 브랜치 `fix/mobile-session-polish`
- HEAD `8c0c25e`: 알림 진입·초기화 복구.
- 최근 커밋:
  - `8ea5514`: offset 0에서 불필요한 하단 이동 명령 억제
  - `af30e30`: chunk 기능 협상·암호화 경로 재조립 테스트
  - `95969d8`: 초안·첨부가 있어도 중지 버튼 유지
  - `b4b6e89`: 고정 작성중 행 제거·세션 정보 단일 전체 높이
  - `e61d8c8`: 실시간 동작 줄이기 정책
- 미커밋: `src/timeline.tsx`, `src/modal-lifecycle.test.ts`, `src/live-text.test.ts` 신규, `src/text-reveal.ts` 삭제. 스크롤 워커가 만든 **인위적 live reveal 제거**다. 다른 워커가 삭제한 것이 아님.
- `apps/ripple-remote`가 본체에서 gitignore됐어도 이 경로 자체가 별도 git 저장소다. 여기에 만든 변경을 다시 다른 곳으로 옮길 필요 없다.

**이번 작업에서 push·배포·운영 라우터 재시작·설치본 교체를 하지 않았다.** 사용자가 보고 있는 실앱은 새 커밋이 아직 반영되지 않았을 수 있다.

## 4. 실행 중인 DeepSeek 3개 (ListAgents 확인)

### 설치 소유권 — `a9fa1c09b3055502b`

- 품질 B01~B03, Windows PID 범위. CLI 소스와 tests를 수정 중.
- 소유 파일: `packages/cli/src/{codex,doctor,index,integrations,launchd,registration,schtasks,settings,supervisor,systemd}.ts`, 신규 `owners.ts`,`ownership.ts`; 관련 launchd/recovery/systemd/ownership/settings-ownership 테스트.
- 승인된 설계:
  1. 다른 설치 또는 소유권 불명인 서비스 정의는 install/repair에서 덮어쓰기 거부.
  2. stop/restart/uninstall에도 같은 소유권 게이트. Windows 다른 홈 PID에 신호 금지.
  3. **기본 홈이라고 무조건 지우지 않는다.** legacy는 명확한 자기 설치 증거가 있을 때만 제거, 불명확하면 보존·명시 결과.
  4. settings 홈별 소유권 기록은 원자쓰기·0600. 다른 홈이 같은 값을 참조하면 보존.
  5. Codex는 proxy가 아닌 ingress 포트 + 명시적 설치 소유권으로 판단. Desktop proxy는 기존 proxy 포트 기준 유지.
- 서비스 → settings/Codex 두 단계. 삭제·중단 경계 전체 diff 검수 필요.
- 실제 CLI subprocess/launchctl/systemctl/schtasks/키체인/프로세스 종료는 승인하지 않았다. 임시 A/B 설치+주입 fake executor만.
- 인접 launcher/direct/codex off 문제는 B22~B24로 별도 기록.
- 중간 타입 오류가 `packages/cli/test/ownership.test.ts`, `recovery.test.ts`에 있었음. 작업 완료 후 전체 타입 검사 필요.

### 웹 발신함 — `a421f429d49a791f2`

- 품질 B05/B16/B17. 웹 app/outbox/watch/html/views/style 및 tests.
- 1차 구현: 호스트별 outbox, 거절한 원문 보존+재시도/수정, 화면 전환 detach.
- 메인이 **승인 보류한 결함**, 보완 요청을 받은 상태:
  1. `readOutbox`가 parse 실패/잘못된 항목을 빈 목록·filter로 처리하면 다음 저장에서 원문 삭제 가능. 실패와 빈 저장소를 구분하고 손상 raw 보존/쓰기 차단/복구.
  2. 구형 `rr.outbox`를 화면에서 숨김. 자동전송은 금지하되 원문 조회·사용자 확인 후 복구 UI 필요. 신규 문구 제안은 main에 먼저 제출하도록 함.
  3. `local:` create 화면에서 수정한 텍스트를 같은 ID로 교체하면 이미 처리된 요청과 충돌. 동일 내용 재시도만 같은 ID, 내용 변경·결과 미확인 정책 구분.
  4. relay url/server만으로 호스트 구분하면 같은 server의 공개키 교체를 놓침. 공개키 포함. direct origin도 신원 증거 보완, 토큰 평문을 key/log에 쓰지 않음.
  5. 편집 버튼에 '답장' aria-label 재사용 부적절, 터치영역 28px도 개선 요청.
  6. no_session 오류의 clientMsgId 상관관계가 빠진 경로는 확인 후 제안.
- 빌드 안정성을 위해 **공유 timeline/dom/i18n 및 native 소스는 편집 동결** 지시. 웹 app/outbox/views/style 위주 보완 가능.
- 공유 `Outgoing`/`Item.user`에는 호환 가능한 `error?: string`만 추가. 초기의 queue.failed/clientMsgId 유니온 변경은 철회되어 native tsc는 통과했다.
- `dom.ts`의 DOM 처리만 `html.ts`로 분리함. 이를 임의 원복하지 않는다.

### 스크롤 시각검증 — `a45e8cce4d09db70a`

- noop 하단 이동 제거는 `8ea5514` 커밋됨.
- 후속: 수신 원문을 다시 150ms RAF로 나눠 그리던 `useTextReveal` 제거. 원문 즉시 렌더, 캐럿/긴본문/복사는 유지. 위 모바일 미커밋 4파일이 이 작업.
- tests: live-text는 실제 TimelineItem/Markdown으로 한글·emoji·결합문자·코드/표·완료·전체 복사·추가 RAF 0 검증. 옛 hook을 넣으면 실패했다는 보고. 성능·실기기 향상은 아직 미측정.
- **16:26경 재개 승인 후 빌드 성공.** 공유 웹 production 동결과 알림 편집 종료 확인 후 Release 빌드를 마쳤으나 entitlement·UI 조작 도구 문제로 관찰은 중단됨. 맨 위 최신 결과의 증거와 재개 조건 참조.
- 승인 조건:
  - 앱 tsc와 `packages/remote/tsconfig.web.json` 통과. 무관한 CLI 테스트 타입 오류만으로 앱 검증을 막지 않음.
  - 새 일회용 iPhone 18 Pro sim(iOS 27.0), 새 UDID에만 설치·실행.
  - 기존 부팅 sim 두 대와 실기기/운영 앱 조작 금지.
  - 기존 8081 Metro는 **saju-app 소유**. 종료·재사용 금지.
  - 기존 workspace `ios/RippleRemote.xcworkspace`, scheme RippleRemote, **Release**, simulator SDK, `CODE_SIGNING_ALLOWED=NO`, 소유 tmp DerivedData. Release는 JS 내장이라 Metro 불필요. 현 Pods 마커도 Release.
  - prebuild/pod install/의존성 갱신·운영 키 복사 금지. generated 변경이 필요하면 보고.
  - 새 sim에 pairing 없음, `ripple-remote://?demo=1`만. DemoLink는 인프로세스, relay/계정 접속 금지.
  - 실제 내용이 증가하는 demo active 상태인지 먼저 확인. idle/live/tool/keyboard 영상·대표 프레임. 정상 thumb 길이 변화와 같은 높이에서의 위치 왕복을 구분.
  - 증거 `/tmp/ripple-scroll-verify/<timestamp>/` 보존. 본인이 만든 sim/프로세스만 정리.
- **알림 탭은 일반 딥링크로 대체 검증 불가.** simctl push는 계정 없이 가능하지만 새 demo sim은 알림 권한 프롬프트가 비활성화돼 네이티브 탭 검증 조건이 부족. 이번 시각검증은 scrollbar 한정, 알림 기기 경로는 미검증으로 남김.

## 5. 가장 최근 완료·검증 상태

### 원문 chunk 전송 — 커밋 완료

본체 `04d38cc`, 앱 `af30e30`. 원문 UTF-8 bytes→base64 chunk→완성 후 기존 HostMsg 처리. 256KiB frame, 원문16MiB, 동시조립8건/총선언16MiB, 완료ID32개 상한. 같은소켓 ready 재장전 generation, malformed ID/base64/중첩chunk 방어. 완성 ready 전에는 connecting 유지. 모바일 암호화 경로 테스트까지 포함.
- 메인 전송 관련116개 및 최종 mobile/codec38개 테스트 확인, 양 저장소 타입 검사 통과.
- 기존 host/client 조합의 큰목록 한계는 남음. 무제한 보장으로 표현하지 않음.
- 조립 만료 평가는 ping loop에서만, 최대 약40초. 미인증 ready는 별도8초 deadline.

### 알림 검은 화면 — 코드 커밋, 제보 기기 대조 남음

앱 `8c0c25e`, 4파일 `_layout/client/각 tests`.
- 메인51개 테스트+mobile tsc 통과. worker 전체219개 통과 보고.
- 선택설정3초 후 fallback, 필수pairing/outbox 읽기 실패는 loaded를 거짓 게시하지 않고 원문/디스크 보존, 오류+Retry.
- 초기화 generation, 저장소 정리 직렬화, presence listener/timer1회.
- 실제 네이티브 저장소 정리 자체가 hang이면 재시도로 해결되지 않음. 손상된 keychain은 자동삭제하지 않음.
- iOS Scene/headless Android 등 실제 검은화면 원인 일치 미확인.

### 모드 컨텍스트·장애 표시 — 커밋 완료

본체 `a4632e0`.
- 장애 notice가 이전 route보다 우선.
- full/summary count를 generation/model/window/compact/요청run에 결합. clear/resume/compaction 중 지연 응답이 새 상태 덮기 방지.
- worker 강제 sandbox 엔진247개 통과, main 전체핵심diff+모드tsc 확인.
- 엔진 테스트는 실제 운영 CLI로 일반 실행 금지. 성공한 방식은 sandbox-exec(network deny, 소유 tmp 외 write deny, 키/운영인증 read deny)+env-i 임시 HOME/CLAUDE_CONFIG_DIR/CLAUDERIPPLE_HOME/TMPDIR. 먼저 무해한 경계 검사 후 사용. 전체 엔진테스트 재실행은 필요할 때만.

## 6. 인계 후 이어갈 우선순위

1. 실행 중3개 완료 신호를 받아 안전 경계 검수. 시뮬레이터 결과와 증거를 확인하고 미확인 조건을 기록.
2. live-text 후속은 코드·테스트 검수 후 모바일에 커밋. shared web 수정과 섞지 않음.
3. 웹 outbox의 숨김/오전송/ID 재사용/손상복구를 해결한 뒤 커밋. 사용자 공개 새 문구가 필요하면 검수 허락 요청.
4. 설치 소유권은 other/unknown 보호 및 legacy 예외를 집중 검수. 실제 서비스 제거로 테스트하지 않음.
5. 원장의 남은 P0/P1 계속 DeepSeek로 구현. 특히 모바일 연결해제 잔존(B04), 위젯외부열기(B06), 푸시개인정보(B07), 워커fail-open(B09), 사용량오집계(B12) 등 아직 미완료.
6. U/G 항목은 기능만 있는지뿐 아니라 실패/취소/복귀/접근성/성능/기기행동을 완료 기준으로 둔다. 현재 문서 원장의 대기 항목을 누락하지 않음.

## 7. 기타 주의

- 한도는 읽기 전용 `http://127.0.0.1:8792/api/limits`가 모드와 같은 출처. 15:15 당시 GPT 주간4% 사용/96% 잔여, 5시간 값은 없었음. 현재 사실로 재사용하지 말고 필요할 때만 다시 조회. account label/token 출력 금지.
- 논리 단위 커밋, push는 사용자 승인 필요. 사용자 변경을 reset/checkout으로 지우지 않음.
- source Edit, 신규 Write. 원장·이 인계는 내부 관리 문서다.
- 브레인 vault는 읽기 전용. 이 파일을 vault에 직접 복사하지 않음.
- 공개 앱 문구와 실제 기능 정책을 혼동하지 말고, 프라이버시/삭제/음성 등 제품 결정은 사용자에게 확인.
- 연구 워커가 보고서를 파일로 저장하지 않았다고 한 경우가 있었음. 상세 원문 보고는 대화에 있고, 재개에 필요한 발견·근거·한계는 원장에 보존했다. research_notes/reports 디렉터리만 존재할 수 있으며 완성 보고서라고 주장하지 않음.
