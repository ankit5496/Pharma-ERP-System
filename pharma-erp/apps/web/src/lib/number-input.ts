/**
 * Stops the scroll wheel changing a `type="number"` field.
 *
 * A focused number input increments on wheel, natively. Somebody types 36 into
 * a quantity, scrolls the dialog to reach the save button, and arrives with 41
 * — silently, because the pointer happened to be over the field on the way
 * past. On a long form that scrolls, this is the most likely way a wrong
 * number gets saved, and it leaves no trace that anything was changed.
 *
 * BLURRING is what stops it: the behaviour belongs to the FOCUSED element, so
 * dropping focus ends it and the page goes on scrolling normally.
 * `preventDefault()` does not work here — React registers wheel listeners as
 * passive, and a passive listener may not cancel its event.
 *
 * Spread onto any raw `<input type="number">`. The master-data `TextField` has
 * this behaviour built in, so those call sites need nothing.
 */
export const noWheelChange = {
  onWheel: (event: React.WheelEvent<HTMLInputElement>) => {
    (event.target as HTMLInputElement).blur();
  },
} as const;
