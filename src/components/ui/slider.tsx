import * as React from 'react';
import { cn } from '@/lib/utils';

interface SliderProps extends React.InputHTMLAttributes<HTMLInputElement> {
  value?: number;
  onValueChange?: (value: number) => void;
}

const Slider = React.forwardRef<HTMLInputElement, SliderProps>(
  ({ className, value = 0, onValueChange, ...props }, ref) => {
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const newValue = parseFloat(e.target.value);
      onValueChange?.(newValue);
    };

    return (
      <div className="relative flex w-full items-center">
        <input
          type="range"
          className={cn(
            'peer h-2 w-full cursor-pointer appearance-none rounded-lg bg-secondary/50 accent-primary',
            className
          )}
          ref={ref}
          value={value}
          onChange={handleChange}
          {...props}
        />
        <div
          className="absolute h-2 rounded-lg pointer-events-none bg-emerald-500/80"
          style={{ width: `${((value - (props.min ? Number(props.min) : 0)) / ((props.max ? Number(props.max) : 100) - (props.min ? Number(props.min) : 0))) * 100}%` }}
        />
      </div>
    );
  }
);
Slider.displayName = 'Slider';

export { Slider };
