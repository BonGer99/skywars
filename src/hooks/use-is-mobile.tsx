import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(false)

  React.useEffect(() => {
    const checkDevice = () => {
      const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
      const isSmallScreen = window.innerWidth < MOBILE_BREAKPOINT;
      setIsMobile(isTouch || isSmallScreen);
    }

    checkDevice();
    window.addEventListener("resize", checkDevice);

    return () => window.removeEventListener("resize", checkDevice);
  }, [])

  return isMobile
}
