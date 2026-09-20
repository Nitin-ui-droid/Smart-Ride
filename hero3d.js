/* =========================================================
   RIDEMITRA — 3D HERO
   A low-poly car driving a loop while the whole track slowly
   turntables. Built with primitive Three.js geometry only
   (no external model files), so it stays lightweight.
========================================================= */

(function () {
    "use strict";

    const mount = document.getElementById("heroStage");
    if (!mount || typeof THREE === "undefined") return;

    let renderer, scene, camera;
    let world, car;
    let carAngle = 0;
    const ROAD_RADIUS = 4.2;

    function init() {
        scene = new THREE.Scene();
        scene.fog = new THREE.FogExp2(0x12110f, 0.055);

        camera = new THREE.PerspectiveCamera(
            42,
            mount.clientWidth / mount.clientHeight,
            0.1,
            100
        );
        camera.position.set(0, 6.4, 10.5);
        camera.lookAt(0, 0, 0);

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(mount.clientWidth, mount.clientHeight);
        mount.innerHTML = "";
        mount.appendChild(renderer.domElement);

        buildLights();

        world = new THREE.Group();
        scene.add(world);

        buildGround();
        buildRoad();
        buildPins();
        car = buildCar();
        world.add(car);

        window.addEventListener("resize", onResize);
        animate();
    }

    function buildLights() {
        scene.add(new THREE.AmbientLight(0x3a3228, 1.4));

        const key = new THREE.DirectionalLight(0xffb444, 1.6);
        key.position.set(6, 8, 4);
        scene.add(key);

        const rim = new THREE.DirectionalLight(0xff6a1a, 0.9);
        rim.position.set(-6, 3, -6);
        scene.add(rim);
    }

    function buildGround() {
        const geo = new THREE.CircleGeometry(9, 48);
        const mat = new THREE.MeshStandardMaterial({
            color: 0x1c1a17,
            roughness: 1,
            metalness: 0
        });
        const ground = new THREE.Mesh(geo, mat);
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -0.42;
        world.add(ground);
    }

    function buildRoad() {
        // Asphalt ring
        const roadGeo = new THREE.TorusGeometry(ROAD_RADIUS, 0.95, 16, 80);
        const roadMat = new THREE.MeshStandardMaterial({
            color: 0x24211c,
            roughness: 0.9,
            metalness: 0.05
        });
        const road = new THREE.Mesh(roadGeo, roadMat);
        road.rotation.x = Math.PI / 2;
        road.scale.y = 0.14;
        world.add(road);

        // Dashed lane line — the same motif as the CSS .route-rule
        const dashGeo = new THREE.BoxGeometry(0.42, 0.06, 0.12);
        const dashMat = new THREE.MeshStandardMaterial({
            color: 0xffb444,
            emissive: 0xff6a1a,
            emissiveIntensity: 0.5,
            roughness: 0.4
        });
        const dashCount = 28;
        for (let i = 0; i < dashCount; i++) {
            const angle = (i / dashCount) * Math.PI * 2;
            const dash = new THREE.Mesh(dashGeo, dashMat);
            dash.position.set(Math.cos(angle) * ROAD_RADIUS, 0.08, Math.sin(angle) * ROAD_RADIUS);
            dash.rotation.y = -angle;
            world.add(dash);
        }
    }

    function buildPin(color) {
        const group = new THREE.Group();

        const head = new THREE.Mesh(
            new THREE.SphereGeometry(0.22, 16, 16),
            new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35 })
        );
        head.position.y = 0.5;
        group.add(head);

        const tip = new THREE.Mesh(
            new THREE.ConeGeometry(0.14, 0.32, 16),
            new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.2 })
        );
        tip.position.y = 0.18;
        tip.rotation.x = Math.PI;
        group.add(tip);

        return group;
    }

    function buildPins() {
        const angles = [0.4, 1.9, 3.3, 4.9];
        const colors = [0xff6a1a, 0xffb444, 0xff6a1a, 0xffb444];

        angles.forEach((angle, i) => {
            const pin = buildPin(colors[i]);
            pin.position.set(
                Math.cos(angle) * (ROAD_RADIUS + 1.5),
                0.9,
                Math.sin(angle) * (ROAD_RADIUS + 1.5)
            );
            pin.userData.bobOffset = i * 1.3;
            world.add(pin);
            (buildPins.list = buildPins.list || []).push(pin);
        });
    }

    function buildCar() {
        const group = new THREE.Group();

        const bodyMat = new THREE.MeshStandardMaterial({ color: 0xff6a1a, roughness: 0.35, metalness: 0.3 });
        const glassMat = new THREE.MeshStandardMaterial({ color: 0x1c1a17, roughness: 0.1, metalness: 0.6 });
        const wheelMat = new THREE.MeshStandardMaterial({ color: 0x0e0d0c, roughness: 0.8 });

        const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.32, 0.58), bodyMat);
        body.position.y = 0.28;
        group.add(body);

        const cabin = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.28, 0.52), glassMat);
        cabin.position.set(-0.05, 0.56, 0);
        group.add(cabin);

        const wheelGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.12, 16);
        const wheelPositions = [
            [0.38, 0.16, 0.3], [0.38, 0.16, -0.3],
            [-0.38, 0.16, 0.3], [-0.38, 0.16, -0.3]
        ];
        wheelPositions.forEach(([x, y, z]) => {
            const wheel = new THREE.Mesh(wheelGeo, wheelMat);
            wheel.rotation.z = Math.PI / 2;
            wheel.position.set(x, y, z);
            group.add(wheel);
        });

        const headlight = new THREE.PointLight(0xffe3b0, 1.1, 3.2);
        headlight.position.set(0.7, 0.3, 0);
        group.add(headlight);

        group.scale.setScalar(0.85);
        return group;
    }

    function onResize() {
        if (!mount.clientWidth || !mount.clientHeight) return;
        camera.aspect = mount.clientWidth / mount.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(mount.clientWidth, mount.clientHeight);
    }

    function animate(time) {
        requestAnimationFrame(animate);
        const t = (time || 0) / 1000;

        // Turntable: the whole track rotates slowly
        world.rotation.y = t * 0.18;

        // Car drives around the loop, faster than the turntable
        carAngle = t * 0.55;
        car.position.set(Math.cos(carAngle) * ROAD_RADIUS, 0.12, Math.sin(carAngle) * ROAD_RADIUS);
        car.rotation.y = -carAngle + Math.PI / 2;

        // Pins bob gently
        (buildPins.list || []).forEach(pin => {
            pin.position.y = 0.9 + Math.sin(t * 1.4 + pin.userData.bobOffset) * 0.12;
        });

        camera.position.y = 6.4 + Math.sin(t * 0.25) * 0.4;
        camera.lookAt(0, 0.2, 0);

        renderer.render(scene, camera);
    }

    try {
        init();
    } catch (error) {
        console.error("RideMitra 3D hero failed to load:", error);
        // .hero-stage already has a CSS gradient fallback background.
    }
})();
