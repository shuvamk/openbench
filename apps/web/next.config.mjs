/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@openbench/ir-schema",
    "@openbench/registry",
    "@openbench/netlist-compiler",
    "@openbench/mcp-sim-ngspice",
  ],
};
export default nextConfig;
