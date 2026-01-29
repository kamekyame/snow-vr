import "aframe";
import type {
	InstancedMesh,
	MeshStandardMaterial,
	Object3D,
	Quaternion,
	SphereGeometry,
	Texture,
	Vector3,
} from "three";
import type { Entity as AEntity, Scene as AScene } from "aframe";

const THREE = AFRAME.THREE;

type SnowSystem = {
	groundHeight: number;
	snowballs: Set<AEntity>;
	arActive: boolean;
	noiseTexture: Texture | null;
	lastSpawnTime: number;
	registerSnowball: (el: AEntity) => void;
	unregisterSnowball: (el: AEntity) => void;
	setGroundHeight: (height: number) => void;
};

type SnowScene = AScene & { systems: { snow: SnowSystem } };

type SnowfallState = {
	points: InstancedMesh | null;
	geometry: SphereGeometry | null;
	material: MeshStandardMaterial | null;
	positions: Float32Array;
	velocities: Float32Array;
	phases: Float32Array;
	scales: Float32Array;
	data: {
		enabled: boolean;
		count: number;
		area: number;
		height: number;
		fallSpeed: number;
		windX: number;
		windZ: number;
		size: number;
		opacity: number;
	};
	el: AEntity;
};

type RollingHandState = {
	rollingSnowball: AEntity | null;
	lastHandPosition: Vector3 | null;
	grabbedSnowball: AEntity | null;
	prevHandPosition: Vector3 | null;
	smoothedHandPoint: Vector3 | null;
	handVelocity: Vector3 | null;
	otherHandEl: AEntity | null;
	handSign: number;
	handDebug: AEntity | null;
	contactDebug: AEntity | null;
	snowballDebug: AEntity | null;
	debugSnowball: AEntity | null;
	lastHapticTime: number;
	onGrabStart: () => void;
	onGrabEnd: () => void;
	pulse: (intensity: number, duration: number) => void;
	getHandPoint: (handPosition: Vector3) => Vector3;
	getContactDistance: (radius: number) => number;
	findNearestSnowball: (
		handPosition: Vector3,
		snowballs: AEntity[],
	) => {
		nearest: AEntity | null;
		nearestDistance: number;
		nearestRadius: number;
	};
	data: {
		handRadius: number;
		releasePadding: number;
		pushStrength: number;
		sinkDepth: number;
		rollThreshold: number;
		crushThreshold: number;
		fingertipOffset: { x: number; y: number; z: number };
		debug: boolean;
	};
	el: AEntity;
};

const createSnowballEntity = (sceneEl: SnowScene, position: Vector3) => {
	const snowball = document.createElement("a-entity") as AEntity;
	snowball.setAttribute("geometry", {
		primitive: "sphere",
		radius: 0.03,
		segmentsWidth: 24,
		segmentsHeight: 24,
	});
	snowball.setAttribute("material", {
		color: "#f8f9fb",
		shader: "standard",
		roughness: 0.98,
		metalness: 0.0,
	});
	snowball.setAttribute("snowball", "");
	snowball.object3D.position.copy(position);
	sceneEl.appendChild(snowball);
	const system = sceneEl.systems.snow;
	const applyNoise = () => {
		const mesh = snowball.getObject3D("mesh");
		if (!mesh || !system?.noiseTexture) {
			return;
		}
		mesh.traverse((child: Object3D) => {
			if (child instanceof THREE.Mesh) {
				const materials = Array.isArray(child.material)
					? child.material
					: [child.material];
				for (const material of materials) {
					if (material instanceof THREE.MeshStandardMaterial) {
						material.map = system.noiseTexture;
						material.bumpMap = system.noiseTexture;
						material.bumpScale = 0.03;
						material.needsUpdate = true;
					}
				}
			}
		});
	};
	if (snowball.hasLoaded) {
		applyNoise();
	} else {
		snowball.addEventListener("loaded", applyNoise);
	}
	return snowball;
};

const createNoiseTexture = () => {
	const size = 64;
	const canvas = document.createElement("canvas");
	canvas.width = size;
	canvas.height = size;
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return null;
	}
	const image = ctx.createImageData(size, size);
	for (let i = 0; i < image.data.length; i += 4) {
		const value = 220 + Math.floor(Math.random() * 35);
		image.data[i] = value;
		image.data[i + 1] = value;
		image.data[i + 2] = value;
		image.data[i + 3] = 255;
	}
	ctx.putImageData(image, 0, 0);
	const texture = new THREE.CanvasTexture(canvas);
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	texture.repeat.set(1.5, 1.5);
	return texture;
};

if (!AFRAME.systems?.snow) {
	AFRAME.registerSystem("snow", {
		init() {
			const system = this as unknown as SnowSystem;
			system.groundHeight = 0;
			system.snowballs = new Set();
			system.arActive = false;
			system.noiseTexture = createNoiseTexture();
			system.lastSpawnTime = 0;
		},
		registerSnowball(el: AEntity) {
			const system = this as unknown as SnowSystem;
			system.snowballs.add(el);
		},
		unregisterSnowball(el: AEntity) {
			const system = this as unknown as SnowSystem;
			system.snowballs.delete(el);
		},
		setGroundHeight(height: number) {
			const system = this as unknown as SnowSystem;
			system.groundHeight = height;
		},
	});
}

if (!AFRAME.components["snow-field"]) {
	AFRAME.registerComponent("snow-field", {
		init() {
			const scene = this.el.sceneEl as SnowScene | undefined;
			if (!scene) {
				return;
			}
			const ground = scene.querySelector("#ground");
			const system = scene.systems.snow;
			const renderer = scene.renderer;

			const setArMode = (enabled: boolean) => {
				system.arActive = enabled;
				system.setGroundHeight(0);
				if (renderer) {
					renderer.setClearAlpha(enabled ? 0 : 1);
				}
				if (ground) {
					ground.setAttribute("visible", String(!enabled));
				}
			};

			scene.addEventListener("enter-vr", () => {
				if (scene.is("ar-mode")) {
					setArMode(true);
				}
			});

			scene.addEventListener("exit-vr", () => {
				setArMode(false);
			});
		},
	});
}

if (!AFRAME.components.snowfall) {
	AFRAME.registerComponent("snowfall", {
		schema: {
			enabled: { type: "boolean", default: true },
			count: { type: "int", default: 1080 },
			area: { type: "number", default: 12 },
			height: { type: "number", default: 10 },
			fallSpeed: { type: "number", default: 0.45 },
			windX: { type: "number", default: 0.03 },
			windZ: { type: "number", default: 0.015 },
			size: { type: "number", default: 0.012 },
			opacity: { type: "number", default: 1.0 },
		},
		init() {
			const component = this as unknown as SnowfallState;
			const count = Math.max(1, Math.floor(component.data.count));
			const area = Math.max(1, component.data.area);
			const height = Math.max(1, component.data.height);
			const scene = component.el.sceneEl as SnowScene | undefined;
			const groundY = scene?.systems?.snow?.groundHeight ?? 0;

			component.positions = new Float32Array(count * 3);
			component.velocities = new Float32Array(count);
			component.phases = new Float32Array(count);
			component.scales = new Float32Array(count);
			for (let i = 0; i < count; i += 1) {
				const offset = i * 3;
				component.positions[offset] = (Math.random() - 0.5) * area;
				component.positions[offset + 1] =
					groundY + Math.random() * height + height * 0.2;
				component.positions[offset + 2] = (Math.random() - 0.5) * area;
				component.velocities[i] =
					component.data.fallSpeed * (0.6 + Math.random() * 0.6);
				component.phases[i] = Math.random() * Math.PI * 2;
				component.scales[i] = 0.6 + Math.random() * 0.8;
			}

			const geometry = new THREE.SphereGeometry(component.data.size, 6, 6);
			const material = new THREE.MeshStandardMaterial({
				color: 0xffffff,
				transparent: true,
				opacity: component.data.opacity,
				roughness: 0.98,
				metalness: 0.0,
			});
			const points = new THREE.InstancedMesh(geometry, material, count);
			points.frustumCulled = false;
			points.renderOrder = 2;
			const temp = new THREE.Object3D();
			for (let i = 0; i < count; i += 1) {
				const offset = i * 3;
				temp.position.set(
					component.positions[offset],
					component.positions[offset + 1],
					component.positions[offset + 2],
				);
				temp.scale.setScalar(component.scales[i]);
				temp.updateMatrix();
				points.setMatrixAt(i, temp.matrix);
			}

			component.geometry = geometry;
			component.material = material;
			component.points = points;
			component.el.object3D.add(points);
		},
		tick(time: number, timeDelta: number) {
			const component = this as unknown as SnowfallState;
			if (!component.data.enabled || !component.points || !component.geometry) {
				return;
			}
			const deltaSeconds = timeDelta / 1000;
			if (deltaSeconds <= 0) {
				return;
			}
			const scene = component.el.sceneEl as SnowScene | undefined;
			const groundY = scene?.systems?.snow?.groundHeight ?? 0;
			const area = Math.max(1, component.data.area);
			const height = Math.max(1, component.data.height);
			const halfArea = area * 0.5;
			const windX = component.data.windX;
			const windZ = component.data.windZ;
			const swayAmp = 0.12;
			const swaySpeed = 0.0012;

			const temp = new THREE.Object3D();
			for (let i = 0; i < component.velocities.length; i += 1) {
				const offset = i * 3;
				const phase = component.phases[i];
				const swayX = Math.sin(time * swaySpeed + phase) * swayAmp;
				const swayZ = Math.cos(time * swaySpeed * 1.3 + phase) * swayAmp;
				component.positions[offset] += windX * deltaSeconds;
				component.positions[offset + 1] -=
					component.velocities[i] * deltaSeconds;
				component.positions[offset + 2] += windZ * deltaSeconds;
				component.positions[offset] += swayX * deltaSeconds;
				component.positions[offset + 2] += swayZ * deltaSeconds;

				if (component.positions[offset] > halfArea) {
					component.positions[offset] = -halfArea;
				} else if (component.positions[offset] < -halfArea) {
					component.positions[offset] = halfArea;
				}
				if (component.positions[offset + 2] > halfArea) {
					component.positions[offset + 2] = -halfArea;
				} else if (component.positions[offset + 2] < -halfArea) {
					component.positions[offset + 2] = halfArea;
				}

				if (component.positions[offset + 1] < groundY - 0.2) {
					component.positions[offset] = (Math.random() - 0.5) * area;
					component.positions[offset + 1] =
						groundY + height + Math.random() * height * 0.4;
					component.positions[offset + 2] = (Math.random() - 0.5) * area;
					component.velocities[i] =
						component.data.fallSpeed * (0.6 + Math.random() * 0.6);
					component.phases[i] = Math.random() * Math.PI * 2;
					component.scales[i] = 0.6 + Math.random() * 0.8;
				}
				temp.position.set(
					component.positions[offset],
					component.positions[offset + 1],
					component.positions[offset + 2],
				);
				temp.scale.setScalar(component.scales[i]);
				temp.updateMatrix();
				component.points.setMatrixAt(i, temp.matrix);
			}
			component.points.instanceMatrix.needsUpdate = true;
		},
		remove() {
			const component = this as unknown as SnowfallState;
			if (component.points) {
				component.el.object3D.remove(component.points);
			}
			component.geometry?.dispose();
			component.material?.dispose();
			component.points = null;
			component.geometry = null;
			component.material = null;
		},
	});
}

if (!AFRAME.components.snowball) {
	AFRAME.registerComponent("snowball", {
		schema: {
			radius: { type: "number", default: 0.03 },
		},
		init() {
			const component = this as unknown as {
				baseRadius: number;
				radius: number;
				velocity: Vector3;
				snowSystem: SnowSystem;
				data: { radius: number };
				el: AEntity;
			};
			component.baseRadius = component.data.radius;
			component.radius = component.data.radius;
			component.velocity = new THREE.Vector3();
			component.snowSystem = (component.el.sceneEl as SnowScene).systems.snow;
			component.snowSystem.registerSnowball(component.el);
		},
		remove() {
			const component = this as unknown as {
				snowSystem: SnowSystem;
				el: AEntity;
			};
			component.snowSystem.unregisterSnowball(component.el);
		},
		applyImpulse(impulse: Vector3) {
			const component = this as unknown as { velocity: Vector3 };
			component.velocity.add(impulse);
		},
		growBy(distance: number) {
			const component = this as unknown as {
				baseRadius: number;
				radius: number;
				el: AEntity;
			};
			if (distance <= 0) {
				return;
			}
			const growthScale = 0.05;
			component.radius += distance * growthScale;
			const scale = component.radius / component.baseRadius;
			component.el.object3D.scale.setScalar(scale);
		},
		tick(_time: number, timeDelta: number) {
			const component = this as unknown as {
				radius: number;
				velocity: Vector3;
				snowSystem: SnowSystem;
				el: AEntity;
			};
			const deltaSeconds = timeDelta / 1000;
			if (deltaSeconds <= 0) {
				return;
			}
			component.velocity.y += -9.8 * deltaSeconds;
			component.el.object3D.position.addScaledVector(
				component.velocity,
				deltaSeconds,
			);
			const floorY = component.snowSystem.groundHeight + component.radius;
			if (component.el.object3D.position.y < floorY) {
				component.el.object3D.position.y = floorY;
				if (component.velocity.y < 0) {
					component.velocity.y = 0;
				}
				const groundFriction = Math.max(0, 1 - 3.0 * deltaSeconds);
				component.velocity.x *= groundFriction;
				component.velocity.z *= groundFriction;
			}
			for (let pass = 0; pass < 2; pass += 1) {
				for (const other of component.snowSystem.snowballs) {
					if (other === component.el) {
						continue;
					}
					const otherRadius = other.components.snowball?.radius ?? 0.03;
					const delta = component.el.object3D.position
						.clone()
						.sub(other.object3D.position);
					const distance = delta.length();
					const minDistance = component.radius + otherRadius;
					if (distance > 0 && distance < minDistance) {
						const horizontalDelta = new THREE.Vector3(delta.x, 0, delta.z);
						const horizontalDistance = horizontalDelta.length();
						let normal = delta.multiplyScalar(1 / distance);
						if (
							component.el.object3D.position.y >= other.object3D.position.y &&
							horizontalDistance < minDistance * 0.6
						) {
							normal = new THREE.Vector3(0, 1, 0);
						}
						component.el.object3D.position.copy(
							other.object3D.position
								.clone()
								.add(normal.multiplyScalar(minDistance)),
						);
						const separation = component.velocity.dot(normal);
						if (separation < 0) {
							component.velocity.addScaledVector(normal, -separation);
						}
						const tangential = component.velocity
							.clone()
							.sub(
								normal.clone().multiplyScalar(component.velocity.dot(normal)),
							);
						const friction = Math.max(0, 1 - 20.0 * deltaSeconds);
						component.velocity.sub(tangential.multiplyScalar(1 - friction));
					}
				}
			}
		},
	});
}

if (!AFRAME.components["rolling-hand"]) {
	AFRAME.registerComponent("rolling-hand", {
		schema: {
			handRadius: { type: "number", default: 0.03 },
			releasePadding: { type: "number", default: 0.05 },
			pushStrength: { type: "number", default: 3.0 },
			sinkDepth: { type: "number", default: 0.02 },
			rollThreshold: { type: "number", default: 0.008 },
			crushThreshold: { type: "number", default: 0.03 },
			fingertipOffset: { type: "vec3", default: { x: 0.0, y: -0.05, z: -0.0 } },
			debug: { type: "boolean", default: false },
		},
		init() {
			const component = this as unknown as RollingHandState;
			component.rollingSnowball = null;
			component.lastHandPosition = null;
			component.grabbedSnowball = null;
			component.prevHandPosition = null;
			component.smoothedHandPoint = null;
			component.handVelocity = null;
			component.otherHandEl = null;
			component.handSign = 1;
			component.handDebug = null;
			component.contactDebug = null;
			component.snowballDebug = null;
			component.debugSnowball = null;
			component.lastHapticTime = 0;
			component.onGrabStart = this.onGrabStart.bind(this);
			component.onGrabEnd = this.onGrabEnd.bind(this);
			component.el.addEventListener("gripdown", component.onGrabStart);
			component.el.addEventListener("gripup", component.onGrabEnd);
			component.el.addEventListener("grabstart", component.onGrabStart);
			component.el.addEventListener("grabend", component.onGrabEnd);
			const sceneEl = component.el.sceneEl as AScene | undefined;
			if (component.el.id === "leftHand") {
				component.otherHandEl = sceneEl?.querySelector("#rightHand") ?? null;
				component.handSign = 1;
			} else if (component.el.id === "rightHand") {
				component.otherHandEl = sceneEl?.querySelector("#leftHand") ?? null;
				component.handSign = -1;
			}
			if (component.data.debug) {
				component.handDebug = document.createElement("a-entity") as AEntity;
				component.handDebug.setAttribute("geometry", {
					radius: 1,
					segmentsWidth: 12,
					segmentsHeight: 12,
				});
				component.handDebug.setAttribute("material", {
					color: "#ffcc00",
					wireframe: true,
					opacity: 0.6,
					transparent: true,
				});
				component.el.appendChild(component.handDebug);
				component.contactDebug = document.createElement("a-entity") as AEntity;
				component.contactDebug.setAttribute("geometry", {
					primitive: "sphere",
					radius: 1,
					segmentsWidth: 12,
					segmentsHeight: 12,
				});
				component.contactDebug.setAttribute("material", {
					color: "#ff6600",
					wireframe: true,
					opacity: 0.35,
					transparent: true,
				});
				if (sceneEl) {
					sceneEl.appendChild(component.contactDebug);
				}
			}
		},
		pulse(intensity: number, duration: number) {
			const component = this as unknown as RollingHandState;
			const tracked = component.el.components["tracked-controls"];
			const gamepad = tracked?.controller?.gamepad;
			const actuator = gamepad?.hapticActuators?.[0];
			if (actuator?.pulse) {
				actuator.pulse(intensity, duration);
			}
		},
		getHandPoint(handPosition: Vector3) {
			const component = this as unknown as RollingHandState;
			const handQuaternion = new THREE.Quaternion() as Quaternion;
			component.el.object3D.getWorldQuaternion(handQuaternion);
			return handPosition
				.clone()
				.add(
					new THREE.Vector3(
						component.data.fingertipOffset.x * component.handSign,
						component.data.fingertipOffset.y,
						component.data.fingertipOffset.z,
					).applyQuaternion(handQuaternion),
				);
		},
		getContactDistance(radius: number) {
			return Math.max(
				0.005,
				this.data.handRadius + radius - this.data.sinkDepth,
			);
		},
		findNearestSnowball(handPosition: Vector3, snowballs: AEntity[]) {
			let nearest = null;
			let nearestDistance = Number.POSITIVE_INFINITY;
			let nearestRadius = 0.03;
			for (const snowball of snowballs) {
				const position = snowball.object3D.position;
				const distance = position.distanceTo(handPosition);
				if (distance < nearestDistance) {
					nearestDistance = distance;
					nearest = snowball;
					nearestRadius = snowball.components.snowball?.radius ?? 0.03;
				}
			}
			return { nearest, nearestDistance, nearestRadius };
		},
		onGrabStart() {
			const component = this as unknown as RollingHandState;
			if (component.grabbedSnowball) {
				return;
			}
			const scene = component.el.sceneEl as SnowScene | undefined;
			if (!scene) {
				return;
			}
			const system = scene.systems.snow;
			const handPosition = new THREE.Vector3();
			component.el.object3D.getWorldPosition(handPosition);
			const handPoint = component.getHandPoint(handPosition);
			const snowballs = Array.from(system.snowballs) as AEntity[];
			const { nearest, nearestDistance, nearestRadius } =
				component.findNearestSnowball(handPoint, snowballs);
			if (!nearest) {
				return;
			}
			const contactDistance = component.getContactDistance(nearestRadius);
			if (nearestDistance <= contactDistance + 0.01) {
				const grabbed = nearest;
				component.grabbedSnowball = grabbed;
				component.rollingSnowball = null;
				component.lastHandPosition = null;
				component.el.object3D.attach(grabbed.object3D);
				const snowballComponent = grabbed.components.snowball;
				snowballComponent.velocity.set(0, 0, 0);
				const sizeFactor = Math.max(
					1,
					snowballComponent.radius / snowballComponent.baseRadius,
				);
				const intensity = Math.min(1, 0.6 * Math.min(2.0, sizeFactor));
				component.pulse(intensity, 40);
			}
		},
		onGrabEnd() {
			const component = this as unknown as RollingHandState;
			if (!component.grabbedSnowball) {
				return;
			}
			const snowball = component.grabbedSnowball;
			const worldPosition = new THREE.Vector3();
			snowball.object3D.getWorldPosition(worldPosition);
			const scene = component.el.sceneEl as SnowScene | undefined;
			if (!scene) {
				return;
			}
			scene.object3D.attach(snowball.object3D);
			snowball.object3D.position.copy(worldPosition);
			const snowballComponent = snowball.components.snowball;
			const baseVelocity = component.handVelocity
				? component.handVelocity.clone()
				: new THREE.Vector3();
			const throwVelocity = baseVelocity.multiplyScalar(0.6);
			const throwSpeed = throwVelocity.length();
			if (throwSpeed < 0.2) {
				throwVelocity.set(0, 0, 0);
			} else if (throwSpeed > 3.0) {
				throwVelocity.setLength(3.0);
			}
			snowballComponent.velocity.copy(throwVelocity);
			const system = scene.systems.snow;
			const snowballs = Array.from(system.snowballs).filter(
				(other) => other !== snowball,
			) as AEntity[];
			let target: AEntity | null = null;
			let targetRadius = 0;
			let targetDistance = Number.POSITIVE_INFINITY;
			for (const other of snowballs) {
				const otherPos = other.object3D.position;
				const horizontalDistance = Math.hypot(
					worldPosition.x - otherPos.x,
					worldPosition.z - otherPos.z,
				);
				const otherRadius = other.components.snowball?.radius ?? 0.03;
				if (horizontalDistance < targetDistance) {
					targetDistance = horizontalDistance;
					target = other;
					targetRadius = otherRadius;
				}
			}
			if (target && targetDistance <= targetRadius * 1.2) {
				const targetPos = target.object3D.position;
				snowball.object3D.position.set(
					targetPos.x,
					targetPos.y + targetRadius + snowballComponent.radius,
					targetPos.z,
				);
			} else {
				const groundY = system.groundHeight + snowballComponent.radius;
				if (snowball.object3D.position.y < groundY) {
					snowball.object3D.position.y = groundY;
				}
			}
			const sizeFactor = Math.max(
				1,
				snowballComponent.radius / snowballComponent.baseRadius,
			);
			const intensity = Math.min(1, 0.3 * Math.min(2.0, sizeFactor));
			component.pulse(intensity, 30);
			component.grabbedSnowball = null;
		},
		tick(_time: number, timeDelta: number) {
			const component = this as unknown as RollingHandState;
			const scene = component.el.sceneEl as SnowScene | undefined;
			if (!scene) {
				return;
			}
			const system = scene.systems.snow;
			const handPosition = new THREE.Vector3();
			component.el.object3D.getWorldPosition(handPosition);
			const rawHandPoint = component.getHandPoint(handPosition);
			if (!component.smoothedHandPoint) {
				component.smoothedHandPoint = rawHandPoint.clone();
			}
			const dt = Math.max(0.001, timeDelta / 1000);
			const smoothFactor = 1 - Math.exp(-dt * 18);
			component.smoothedHandPoint.lerp(rawHandPoint, smoothFactor);
			const handPoint = component.smoothedHandPoint;
			if (component.prevHandPosition) {
				const velocity = handPoint.clone().sub(component.prevHandPosition);
				velocity.multiplyScalar(1 / dt);
				component.handVelocity = velocity;
			} else {
				component.handVelocity = new THREE.Vector3();
			}
			const groundHeight = system.groundHeight;
			const handOnGround = new THREE.Vector3(
				handPoint.x,
				groundHeight,
				handPoint.z,
			);
			const now = performance.now();
			const rawDelta = component.prevHandPosition
				? handPoint.clone().sub(component.prevHandPosition)
				: new THREE.Vector3();
			const canSpawn = now - system.lastSpawnTime > 350;

			const snowballs = Array.from(system.snowballs) as AEntity[];
			let nearest = null;
			let nearestDistance = Number.POSITIVE_INFINITY;
			let nearestRadius = 0.03;
			if (
				!component.rollingSnowball &&
				!component.grabbedSnowball &&
				canSpawn
			) {
				const nearGround =
					handPoint.y <= groundHeight + component.data.handRadius + 0.05;
				const lateralSpeed = Math.hypot(rawDelta.x, rawDelta.z);
				const movingUp = rawDelta.y > 0.006;
				if (nearGround && lateralSpeed > 0.005 && movingUp) {
					const spawnPos = new THREE.Vector3(
						handOnGround.x,
						groundHeight + 0.03,
						handOnGround.z,
					);
					createSnowballEntity(scene, spawnPos);
					system.lastSpawnTime = now;
					component.pulse(0.4, 30);
				}
			}
			if (!component.rollingSnowball && !component.grabbedSnowball) {
				const nearestInfo = component.findNearestSnowball(handPoint, snowballs);
				nearest = nearestInfo.nearest;
				nearestDistance = nearestInfo.nearestDistance;
				nearestRadius = nearestInfo.nearestRadius;
				if (nearest) {
					const contactDistance = component.getContactDistance(nearestRadius);
					if (nearestDistance <= contactDistance) {
						component.rollingSnowball = nearest;
						component.lastHandPosition = handPoint.clone();
					}
				}
			}

			const activeRadius = component.rollingSnowball
				? (component.rollingSnowball.components.snowball?.radius ?? 0.03)
				: nearestRadius;
			const baseContactDistance = component.getContactDistance(activeRadius);
			if (component.handDebug) {
				component.handDebug.object3D.scale.setScalar(component.data.handRadius);
			}
			if (component.contactDebug) {
				component.contactDebug.object3D.position.copy(handPoint);
				component.contactDebug.object3D.scale.setScalar(baseContactDistance);
			}

			if (component.rollingSnowball && !component.grabbedSnowball) {
				const currentPosition = component.rollingSnowball.object3D.position;
				const snowballRadius =
					component.rollingSnowball.components.snowball?.radius ?? 0.03;
				const contactDistance = component.getContactDistance(snowballRadius);
				if (component.data.debug) {
					if (component.debugSnowball !== component.rollingSnowball) {
						if (component.snowballDebug?.parentElement) {
							component.snowballDebug.parentElement.removeChild(
								component.snowballDebug,
							);
						}
						component.snowballDebug = document.createElement(
							"a-entity",
						) as AEntity;
						component.snowballDebug.setAttribute("geometry", {
							primitive: "sphere",
							radius: 1,
							segmentsWidth: 12,
							segmentsHeight: 12,
						});
						component.snowballDebug.setAttribute("material", {
							color: "#00ff99",
							wireframe: true,
							opacity: 0.6,
							transparent: true,
						});
						component.rollingSnowball.appendChild(component.snowballDebug);
						component.debugSnowball = component.rollingSnowball;
					}
					if (component.snowballDebug) {
						component.snowballDebug.object3D.scale.setScalar(snowballRadius);
					}
				}
				const distanceToHand = currentPosition.distanceTo(handPoint);
				if (distanceToHand > contactDistance + component.data.releasePadding) {
					const snowballComponent =
						component.rollingSnowball?.components.snowball;
					if (snowballComponent) {
						snowballComponent.velocity.set(0, 0, 0);
					}
					component.rollingSnowball = null;
					component.lastHandPosition = null;
					if (component.snowballDebug?.parentElement) {
						component.snowballDebug.parentElement.removeChild(
							component.snowballDebug,
						);
					}
					component.snowballDebug = null;
					component.debugSnowball = null;
					if (component.contactDebug) {
						component.contactDebug.object3D.position.copy(handPoint);
						component.contactDebug.object3D.scale.setScalar(
							baseContactDistance,
						);
					}
				} else {
					if (component.lastHandPosition && distanceToHand <= contactDistance) {
						const rawDelta = handPoint.clone().sub(component.lastHandPosition);
						const fromAbove =
							handPoint.y >= currentPosition.y + snowballRadius * 0.25;
						const pressedInto = distanceToHand <= snowballRadius * 0.55;
						const nearTop =
							handPoint.y - currentPosition.y <= snowballRadius * 0.55;
						if (fromAbove && pressedInto && nearTop) {
							component.pulse(0.8, 60);
							component.rollingSnowball?.remove();
							component.rollingSnowball = null;
							component.lastHandPosition = null;
							return;
						}
						const handDelta = rawDelta.clone();
						handDelta.y = 0;
						if (fromAbove && rawDelta.y < 0) {
							handDelta.set(0, 0, 0);
						}
						const impulse = handDelta.multiplyScalar(
							component.data.pushStrength,
						);
						const rolling = component.rollingSnowball;
						const snowballComponent = rolling?.components.snowball;
						if (!rolling || !snowballComponent) {
							return;
						}
						const moveDelta = handDelta.clone();
						rolling.object3D.position.add(moveDelta);
						rolling.object3D.position.y = groundHeight + snowballRadius;
						const moveDistance = moveDelta.length();
						if (moveDistance > 0.0001 && snowballRadius > 0.0001) {
							const rollAxis = new THREE.Vector3(
								moveDelta.z,
								0,
								-moveDelta.x,
							).normalize();
							const rollAngle = moveDistance / snowballRadius;
							rolling.object3D.rotateOnWorldAxis(rollAxis, rollAngle);
						}
						snowballComponent.applyImpulse(impulse);
						const rolledDistance = moveDelta.length();
						if (rolledDistance >= component.data.rollThreshold) {
							const sizeFactor = Math.max(
								1,
								snowballComponent.radius / snowballComponent.baseRadius,
							);
							const scaledDistance = rolledDistance / sizeFactor;
							snowballComponent.growBy(scaledDistance);
							const now = performance.now();
							if (now - component.lastHapticTime > 120) {
								const intensity = Math.min(1, 0.2 * Math.min(2.5, sizeFactor));
								component.pulse(intensity, 20);
								component.lastHapticTime = now;
							}
						}
					}
					component.lastHandPosition = handPoint.clone();
				}
			}
			component.prevHandPosition = handPoint.clone();
		},
	});
}

if (!AFRAME.components["spawn-seed"]) {
	AFRAME.registerComponent("spawn-seed", {
		schema: {
			spawnOffset: { type: "number", default: 0.2 },
		},
		init() {
			this.spawnSeed = this.spawnSeed.bind(this);
			this.el.addEventListener("triggerdown", this.spawnSeed);
			this.el.addEventListener("selectstart", this.spawnSeed);
		},
		pulse(intensity: number, duration: number) {
			const tracked = this.el.components["tracked-controls"];
			const gamepad = tracked?.controller?.gamepad;
			const actuator = gamepad?.hapticActuators?.[0];
			if (actuator?.pulse) {
				actuator.pulse(intensity, duration);
			}
		},
		spawnSeed() {
			const scene = this.el.sceneEl as SnowScene | undefined;
			if (!scene) {
				return;
			}
			const handPosition = new THREE.Vector3();
			this.el.object3D.getWorldPosition(handPosition);

			const spawnPosition = new THREE.Vector3(
				handPosition.x,
				handPosition.y + this.data.spawnOffset,
				handPosition.z,
			);

			createSnowballEntity(scene, spawnPosition);
			const system = scene.systems.snow;
			system.lastSpawnTime = performance.now();
			this.pulse(0.4, 30);
		},
	});
}
