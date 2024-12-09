uniform sampler2D positionTexture;
uniform sampler2D velocityTexture;
uniform float deltaTime;
uniform float G;
uniform float softening;

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 pos = texture2D(positionTexture, uv);
  vec4 vel = texture2D(velocityTexture, uv);

  vec3 force = vec3(0.0);

  for (float x = 0.0; x < resolution.x; x++) {
    for (float y = 0.0; y < resolution.y; y++) {
      vec2 otherUV = vec2(x / resolution.x, y / resolution.y);
      vec4 otherPos = texture2D(positionTexture, otherUV);

      vec3 direction = otherPos.xyz - pos.xyz;
      float distanceSquared = dot(direction, direction) + softening;
      float distance = sqrt(distanceSquared);
      float F = (G * otherPos.w) / distanceSquared;

      force += F * normalize(direction);
    }
  }

  vel.xyz += force * deltaTime;
  gl_FragColor = vec4(vel.xyz, 1.0);
}



