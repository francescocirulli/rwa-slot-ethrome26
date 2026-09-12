// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IENSRegistryV2 {
    function register(string calldata label, address owner, address subregistry, address resolver, uint256 roles, uint64 expiry) external returns (uint256);
    function getOwner(uint256 id) external view returns (address);
}
interface IENSFactoryV2 {
    function deployProxy(address implementation, uint256 salt, bytes calldata data) external returns (address);
}
interface IENSResolverV2 {
    function initialize(address admin, uint256 roles, bytes[] calldata setters) external;
    function setAddr(bytes32 node, address account) external;
    function grantRootRoles(uint256 roles, address account) external returns (bool);
    function revokeRootRoles(uint256 roles, address account) external returns (bool);
}

/// @notice Backend-attested Base voucher redemption into real ENSv2 names on Sepolia.
/// @dev The backend is trusted to verify source-chain consumption. Reservations never expire:
/// a consumed voucher must remain recoverable after outages. Parent control remains managed.
contract SlotENSRegistrar {
    uint256 private constant ALL_ROLES = 0x1111111111111111111111111111111111111111111111111111111111111111;
    uint256 private constant NAME_ROLES = (1 << 20) | (1 << 148) | (1 << 24) | (1 << 152) | (1 << 156);
    struct Claim { address owner; string label; bool completed; bytes32 source; address resolver; }
    address public immutable backend;
    IENSRegistryV2 public immutable registry;
    IENSFactoryV2 public immutable factory;
    address public immutable resolverImplementation;
    bytes32 public immutable parentNode;
    uint64 public expiry;
    mapping(bytes32 => Claim) private _claims;
    mapping(bytes32 => bytes32) public labelClaim;
    mapping(bytes32 => bool) public consumedSources;
    mapping(address => bytes32[]) private _ownerClaims;
    event Reserved(bytes32 indexed claimId, address indexed owner, string label);
    event Redeemed(bytes32 indexed claimId, address indexed owner, bytes32 indexed source, string label, address resolver);
    error Unauthorized();
    error InvalidClaim();
    error NameUnavailable();
    error SourceUsed();

    constructor(address backend_, address registry_, address factory_, address resolverImplementation_, bytes32 parentNode_, uint64 expiry_) {
        if (backend_ == address(0) || registry_ == address(0) || factory_ == address(0) || resolverImplementation_ == address(0) || expiry_ <= block.timestamp) revert InvalidClaim();
        backend = backend_; registry = IENSRegistryV2(registry_); factory = IENSFactoryV2(factory_);
        resolverImplementation = resolverImplementation_; parentNode = parentNode_; expiry = expiry_;
    }
    modifier onlyBackend() { if (msg.sender != backend) revert Unauthorized(); _; }
    /// @notice Extend future registration validity after the parent has been renewed.
    function extendExpiry(uint64 newExpiry) external onlyBackend {
        if(newExpiry <= expiry) revert InvalidClaim();
        expiry = newExpiry;
    }
    function claim(bytes32 id) external view returns (Claim memory) { return _claims[id]; }
    function claimCount(address owner) external view returns (uint256) { return _ownerClaims[owner].length; }
    function claimAt(address owner, uint256 index) external view returns (bytes32) { return _ownerClaims[owner][index]; }
    function reserve(bytes32 id, address owner, string calldata label) external onlyBackend {
        if (id == bytes32(0) || owner == address(0) || block.timestamp >= expiry) revert InvalidClaim();
        validateLabel(label);
        Claim storage existing = _claims[id];
        if (existing.owner != address(0)) {
            if (existing.owner != owner || keccak256(bytes(existing.label)) != keccak256(bytes(label))) revert InvalidClaim();
            return;
        }
        bytes32 labelHash = keccak256(bytes(label));
        if (labelClaim[labelHash] != bytes32(0) || registry.getOwner(uint256(labelHash)) != address(0)) revert NameUnavailable();
        labelClaim[labelHash] = id;
        _claims[id] = Claim(owner, label, false, bytes32(0), address(0));
        _ownerClaims[owner].push(id);
        emit Reserved(id, owner, label);
    }
    function fulfill(bytes32 id, bytes32 source) external onlyBackend {
        Claim storage c = _claims[id];
        if (c.owner == address(0) || source == bytes32(0) || block.timestamp >= expiry) revert InvalidClaim();
        if (c.completed) { if (c.source != source) revert InvalidClaim(); return; }
        if (consumedSources[source]) revert SourceUsed();
        consumedSources[source] = true; c.completed = true; c.source = source;
        bytes[] memory setters = new bytes[](0);
        address resolver = factory.deployProxy(resolverImplementation, uint256(id), abi.encodeCall(IENSResolverV2.initialize, (address(this), ALL_ROLES, setters)));
        IENSResolverV2(resolver).setAddr(keccak256(abi.encodePacked(parentNode, keccak256(bytes(c.label)))), c.owner);
        IENSResolverV2(resolver).grantRootRoles(ALL_ROLES, c.owner);
        IENSResolverV2(resolver).revokeRootRoles(ALL_ROLES, address(this));
        registry.register(c.label, c.owner, address(0), resolver, NAME_ROLES, expiry);
        c.resolver = resolver;
        emit Redeemed(id, c.owner, source, c.label, resolver);
    }
    function validateLabel(string memory label) public pure {
        bytes memory b = bytes(label);
        if (b.length < 3 || b.length > 32 || b[0] == 0x2d || b[b.length-1] == 0x2d) revert InvalidClaim();
        for (uint256 i; i < b.length; ++i) {
            bytes1 ch = b[i];
            if (!((ch >= 0x61 && ch <= 0x7a) || (ch >= 0x30 && ch <= 0x39) || ch == 0x2d)) revert InvalidClaim();
        }
    }
}
