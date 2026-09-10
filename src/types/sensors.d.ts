export {};

declare global {
  interface DeviceOrientationEvent {
    webkitCompassHeading?: number;
    webkitCompassAccuracy?: number;
  }

  interface DeviceOrientationEventStatic {
    prototype: DeviceOrientationEvent;
    new (type: string, eventInitDict?: DeviceOrientationEventInit): DeviceOrientationEvent;
    requestPermission?: () => Promise<"granted" | "denied">;
  }

  interface Window {
    DeviceOrientationEvent: DeviceOrientationEventStatic;
    __TESLARADAR_MAP__?: {
      jumpTo: (opts: { zoom?: number; center?: [number, number]; bearing?: number }) => void;
      easeTo: (opts: { zoom?: number; center?: [number, number]; bearing?: number; duration?: number }) => void;
      getCenter: () => { lat: number; lng: number };
      getZoom: () => number;
      getBearing: () => number;
      project: (lngLat: [number, number]) => { x: number; y: number };
    };
  }

  interface AbsoluteOrientationSensor extends EventTarget {
    quaternion: [number, number, number, number] | null;
    start: () => void;
    stop: () => void;
    addEventListener: (
      type: "reading" | "error",
      listener: (event: Event) => void,
    ) => void;
    removeEventListener: (
      type: "reading" | "error",
      listener: (event: Event) => void,
    ) => void;
  }

  interface AbsoluteOrientationSensorConstructor {
    new (options?: { frequency?: number; referenceFrame?: "device" | "screen" }): AbsoluteOrientationSensor;
  }

  var AbsoluteOrientationSensor: AbsoluteOrientationSensorConstructor | undefined;
}
