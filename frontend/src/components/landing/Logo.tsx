// A tiny, reusable component: the little gradient square with a diamond
// icon in it. This is a good "first component" to learn from because it
// only demonstrates one concept: PROPS.

// Props ("properties") are how a parent component passes data down into a
// child component — like function arguments, but for components.
// This `interface` describes the shape of the props this component accepts.
interface LogoProps {
  size?: number;     // the `?` makes it optional
  boxSize?: number;  // both are optional numbers
}

// `{ size = 30, boxSize = 14 }: LogoProps` is destructuring the props
// object AND giving default values in one step. So <Logo /> with no props
// at all still works, using size=30 and boxSize=14.
export default function Logo({ size = 30, boxSize = 14 }: LogoProps) {
  return (
    // In JSX, `style={{ ... }}` looks like double braces but it's really
    // ONE pair of braces (to switch from JSX into JS) containing a JS
    // object literal (the second pair). Unlike HTML, CSS properties are
    // camelCase (borderRadius, not border-radius) and numbers are assumed
    // to be pixels unless otherwise stated.
    <div
      style={{
        width: size,   // uses the `size` prop passed in (or its default)
        height: size,
        borderRadius: 9,
        background: 'linear-gradient(135deg,#7c3aed,#6366f1)',
        display: 'grid',
        placeItems: 'center', // shorthand for centering a grid child both ways
        boxShadow: '0 0 24px rgba(124,58,237,.6)',
      }}
    >
      <div
        style={{
          width: boxSize,   // uses the `boxSize` prop
          height: boxSize,
          background: '#fff',
          // clipPath cuts the div into a diamond/sparkle shape using a
          // polygon of percentage coordinates — pure CSS, nothing React-y.
          clipPath:
            'polygon(50% 0,61% 39%,100% 50%,61% 61%,50% 100%,39% 61%,0 50%,39% 39%)',
        }}
      />
    </div>
  );
}

// Usage elsewhere looks like: <Logo />  or  <Logo size={24} boxSize={11} />
// That second one is how AppNavbar.tsx and Footer.tsx render a smaller logo.
