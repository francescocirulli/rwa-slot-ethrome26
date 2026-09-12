// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;
import {Test} from "forge-std/Test.sol";
import {SlotENSRegistrar, IENSRegistryV2, IENSFactoryV2, IENSResolverV2} from "../src/SlotENSRegistrar.sol";

contract RegistryMock is IENSRegistryV2 {
    mapping(uint256=>address) public owners;
    bool public fail;
    function setFail(bool value) external {fail=value;}
    function getOwner(uint256 id) external view returns(address){return owners[id];}
    function register(string calldata label,address owner,address,address,uint256,uint64) external returns(uint256){
        require(!fail,"registry offline");uint256 id=uint256(keccak256(bytes(label)));require(owners[id]==address(0));owners[id]=owner;return id;
    }
}
contract ResolverMock is IENSResolverV2 {
    mapping(address=>uint256) public roles;
    mapping(bytes32=>address) public addresses;
    function initialize(address admin,uint256 r,bytes[] calldata) external {roles[admin]=r;}
    function setAddr(bytes32 node,address owner) external {require(roles[msg.sender]!=0);addresses[node]=owner;}
    function grantRootRoles(uint256 r,address owner) external returns(bool){require(roles[msg.sender]!=0);roles[owner]=r;return true;}
    function revokeRootRoles(uint256,address owner) external returns(bool){require(roles[msg.sender]!=0);roles[owner]=0;return true;}
}
contract FactoryMock is IENSFactoryV2 {
    function deployProxy(address,uint256,bytes calldata data) external returns(address){
        ResolverMock r=new ResolverMock();(bool ok,)=address(r).call(data);require(ok);return address(r);
    }
}
contract SlotENSRegistrarTest is Test {
    SlotENSRegistrar registrar;
    RegistryMock registry;
    address backend=address(0xBEEF);
    address player=address(0xCAFE);
    bytes32 id=keccak256("claim");
    bytes32 source=keccak256("base source");
    function setUp() public {
        registry=new RegistryMock();
        registrar=new SlotENSRegistrar(backend,address(registry),address(new FactoryMock()),address(1),keccak256("parent"),uint64(block.timestamp+365 days));
    }
    function reserve() internal {vm.prank(backend);registrar.reserve(id,player,"frank");}
    function testOnlyBackendCanReserveAndFulfill() public {
        vm.expectRevert(SlotENSRegistrar.Unauthorized.selector);registrar.reserve(id,player,"frank");
        reserve();vm.expectRevert(SlotENSRegistrar.Unauthorized.selector);registrar.fulfill(id,source);
    }
    function testRetryIsIdempotentAndOwnerReceivesResolverControl() public {
        reserve();reserve();assertEq(registrar.claimCount(player),1);
        vm.prank(backend);registrar.fulfill(id,source);
        vm.prank(backend);registrar.fulfill(id,source);
        SlotENSRegistrar.Claim memory c=registrar.claim(id);
        assertTrue(c.completed);assertEq(registry.getOwner(uint256(keccak256("frank"))),player);
        assertEq(ResolverMock(c.resolver).roles(address(registrar)),0);
        assertGt(ResolverMock(c.resolver).roles(player),0);
        assertEq(ResolverMock(c.resolver).addresses(keccak256(abi.encodePacked(keccak256("parent"),keccak256("frank")))),player);
    }
    function testRegistrationFailureRollsBackConsumptionForRecovery() public {
        reserve();registry.setFail(true);vm.prank(backend);vm.expectRevert();registrar.fulfill(id,source);
        assertFalse(registrar.claim(id).completed);assertFalse(registrar.consumedSources(source));
        registry.setFail(false);vm.prank(backend);registrar.fulfill(id,source);assertTrue(registrar.claim(id).completed);
    }
    function testCannotReplaySourceAcrossClaims() public {
        reserve();vm.startPrank(backend);registrar.fulfill(id,source);registrar.reserve(bytes32(uint256(2)),player,"alice");
        vm.expectRevert(SlotENSRegistrar.SourceUsed.selector);registrar.fulfill(bytes32(uint256(2)),source);vm.stopPrank();
    }
    function testCannotChangeReservedBeneficiaryOrTakeLabel() public {
        reserve();vm.startPrank(backend);
        vm.expectRevert(SlotENSRegistrar.InvalidClaim.selector);registrar.reserve(id,address(1),"frank");
        vm.expectRevert(SlotENSRegistrar.NameUnavailable.selector);registrar.reserve(bytes32(uint256(2)),address(1),"frank");vm.stopPrank();
    }
    function testInvalidLabels() public {
        string[6] memory labels=["ab","-frank","frank-","frank.eth","Frank","a b"];
        for(uint256 i;i<labels.length;i++){vm.expectRevert(SlotENSRegistrar.InvalidClaim.selector);registrar.validateLabel(labels[i]);}
    }
}
