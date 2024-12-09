uniform sampler2D positionTexture;
uniform sampler2D velocityTexture;
uniform float deltaTime;

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 pos = texture2D(positionTexture, uv);
  vec4 vel = texture2D(velocityTexture, uv);

  pos.xyz += vel.xyz * deltaTime;
  gl_FragColor = pos;
}
