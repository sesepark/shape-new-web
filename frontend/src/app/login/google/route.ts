import { redirect } from "next/navigation";
import { API_URL } from "@/lib/api";

/**
 * 로그인을 **우리 주소에서** 시작합니다.
 *
 * 예전에는 로그인 단추가 곧바로 `api.snu-shape.com` 으로 갔습니다. 그런데 홈 화면에
 * 추가해서 앱처럼 쓰는 경우, 앱의 영역(manifest 의 scope = www.snu-shape.com)을
 * 벗어나는 주소로 가는 순간 브라우저 창이 열리면서 **위에 주소 막대가 나타납니다.**
 * 로그인하고 돌아와도 그 창에 남아 있어, 앱으로 들어간 것 같지 않게 됩니다.
 *
 * 첫걸음을 같은 주소로 두면 그 순간에는 앱을 벗어나지 않습니다. 구글 화면 자체는
 * 어쩔 수 없이 바깥이지만, 돌아오는 곳은 다시 앱의 영역입니다.
 */
export const dynamic = "force-dynamic";

export function GET() {
  redirect(`${API_URL}/auth/google/start`);
}
