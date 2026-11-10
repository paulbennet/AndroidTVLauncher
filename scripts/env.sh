# Source from Git Bash or another POSIX shell: . scripts/env.sh
# Your own paths and TV address go in scripts/env.local.sh (git-ignored), for example:
#   export JAVA_HOME="/d/Android/jdk17"; export ANDROID_HOME="/d/Android/Sdk"; export TV="192.168.1.20:5555"
here="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
[ -f "$here/env.local.sh" ] && . "$here/env.local.sh"
export ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) exe=.exe ;; *) exe= ;; esac
export ADB="${ADB:-$ANDROID_HOME/platform-tools/adb$exe}"
export TV="${TV:-}"   # host:port of the TV's network ADB; empty = the only USB/attached device

# The test scripts force-stop the launcher, and Android then turns its accessibility service (Web Launcher home)
# off. Only the user may turn it on again, so warn first and print the command that restores today's list.
home_watch_warn() {
  local list
  list="$("$ADB" -s "$TV" shell settings get secure enabled_accessibility_services 2>/dev/null | tr -d '\r')"
  case ":$list" in *:com.weblauncher.tv/*)
    echo "WARNING: Web Launcher home (accessibility) is on. This test force-stops the launcher, and Android then" >&2
    echo "turns the service off. Turn it on again afterwards (TV Settings -> Accessibility), or run:" >&2
    echo "  adb shell settings put secure enabled_accessibility_services $list" >&2 ;;
  esac
}
