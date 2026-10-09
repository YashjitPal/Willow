import { Link, type LinkProps } from "react-router-dom";
import { Button, type ButtonProps } from "./button";

type AnchorButtonProps = Extract<ButtonProps, { as: "a" }>;
type RouterLinkOptions = Pick<
  LinkProps,
  "to" | "state" | "replace" | "relative" | "reloadDocument" | "preventScrollReset" | "viewTransition" | "discover" | "prefetch"
>;

export type ButtonLinkProps = Omit<AnchorButtonProps, "as" | "renderLink"> & Partial<RouterLinkOptions>;

/** Button rendered as a link (`NE` in the bundles); `to` navigates with react-router, `href` is a plain anchor. */
export function ButtonLink(props: ButtonLinkProps) {
  if (props.to != null) {
    const { to, state, replace, relative, reloadDocument, preventScrollReset, viewTransition, discover, prefetch, ...buttonProps } = props;
    return (
      <Button
        {...buttonProps}
        as="a"
        renderLink={(linkProps) => (
          <Link
            {...linkProps}
            to={to}
            state={state}
            replace={replace}
            relative={relative}
            reloadDocument={reloadDocument}
            preventScrollReset={preventScrollReset}
            viewTransition={viewTransition}
            discover={discover}
            prefetch={prefetch}
          />
        )}
      />
    );
  }
  return <Button {...props} as="a" />;
}
